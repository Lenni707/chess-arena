import type { EngineInfo, MatchBoard, MatchSummary, Result, Tally, TimeControl } from '../shared/protocol.js';
import { START_FEN } from '../shared/protocol.js';
import os from 'node:os';
import { EnginePlayer, Game } from './game.js';
import { EnginePool } from './pool.js';
import type { EngineDef } from './uci.js';

export interface MatchOptions {
  engineA: EngineInfo;
  engineB: EngineInfo;
  defA: EngineDef;
  defB: EngineDef;
  games: number;
  tc: TimeControl;
  /** Games played at the same time; each one is a board in the grid. */
  concurrency: number;
  /** Processes per engine; defaults to half the CPU cores (A and B together fill them). */
  poolSize?: number;
}

export interface MatchTick {
  boards: MatchBoard[];
  tally: Tally;
  running: boolean;
  error?: string;
}

const TICK_MS = 100;

/**
 * Plays N games between engine A and engine B, `concurrency` at a time; each
 * slot (a board in the grid) plays its games one after another. Colors swap every
 * game. The boards don't own engine processes: all games share one small pool per
 * engine sized to the CPU cores, so at most one search runs per core no matter how
 * many boards are shown. That keeps memory bounded and results accurate.
 */
export class Match {
  readonly id = Math.random().toString(36).slice(2, 10);
  readonly boards: MatchBoard[];
  /** The game each board plays now (or played last). */
  readonly current: (Game | null)[];
  readonly tally: Tally;
  running = true;
  /** Why the match stopped early, e.g. an engine that can't start. */
  error?: string;
  readonly poolSize: number;
  private next = 0;
  private stopped = false;
  private live = new Set<Game>();
  private pools: EnginePool[] = [];
  private dirty = new Set<number>();
  private timer: NodeJS.Timeout;

  constructor(
    readonly opts: MatchOptions,
    private onTick: (t: MatchTick) => void,
    private onGameUpdate: (slot: number, g: Game) => void = () => {},
  ) {
    const slots = Math.max(1, Math.min(opts.concurrency, opts.games));
    this.boards = Array.from({ length: slots }, (_, slot) => ({ slot, game: -1, fen: START_FEN, lm: '', aWhite: true, result: '*', last: '*', lastAWhite: true }));
    this.current = this.boards.map(() => null);
    this.poolSize = opts.poolSize ?? Math.max(1, Math.floor(os.cpus().length / 2));
    this.tally = { aWins: 0, bWins: 0, draws: 0, done: 0, total: opts.games, ends: {} };
    this.timer = setInterval(() => this.flush(), TICK_MS);
  }

  summary(): MatchSummary {
    const { engineA, engineB, games, tc } = this.opts;
    return {
      id: this.id,
      engineA: { id: engineA.id, name: engineA.name },
      engineB: { id: engineB.id, name: engineB.name },
      games,
      tc,
      concurrency: this.boards.length,
      running: this.running,
      boards: this.boards,
      tally: this.tally,
      error: this.error,
      poolSize: this.poolSize,
    };
  }

  async run() {
    const poolA = new EnginePool(this.opts.defA, this.poolSize);
    const poolB = new EnginePool(this.opts.defB, this.poolSize);
    this.pools = [poolA, poolB];
    poolA.onBroken = (why) => this.fail(`${this.opts.engineA.name}: ${why}`);
    poolB.onBroken = (why) => this.fail(`${this.opts.engineB.name}: ${why}`);
    // Start the engines once, before any game; an engine that can't start ends the match.
    const started = await Promise.allSettled([poolA.start(), poolB.start()]);
    started.forEach((r, k) => {
      if (r.status === 'rejected') this.fail(`${k ? this.opts.engineB.name : this.opts.engineA.name} failed to start: ${(r.reason as Error).message}`);
    });
    if (!this.stopped) await Promise.all(this.boards.map((b) => this.slot(b, poolA, poolB)));
    this.finish();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const g of this.live) g.stop();
    for (const p of this.pools) p.close();
    this.finish();
  }

  private fail(error: string) {
    if (this.error) return;
    this.error = error;
    this.stop();
  }

  private finish() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.flush(true);
  }

  private async slot(board: MatchBoard, poolA: EnginePool, poolB: EnginePool) {
    while (!this.stopped && this.next < this.opts.games) {
      const i = this.next++;
      const aWhite = i % 2 === 0;
      if (board.result !== '*') [board.last, board.lastAWhite] = [board.result, board.aWhite];
      Object.assign(board, { game: i, fen: START_FEN, lm: '', aWhite, result: '*' });
      this.dirty.add(board.slot);

      const pa = new EnginePlayer(poolA.searcher(), this.opts.engineA.name, this.opts.engineA.id);
      const pb = new EnginePlayer(poolB.searcher(), this.opts.engineB.name, this.opts.engineB.id);
      const game = new Game(`${this.id}-${i}`, aWhite ? pa : pb, aWhite ? pb : pa, this.opts.tc, (g) => {
        board.fen = g.pos.fen();
        board.lm = g.lastMove;
        this.dirty.add(board.slot);
        this.onGameUpdate(board.slot, g);
      });
      this.current[board.slot] = game;
      this.live.add(game);
      await game.run();
      this.live.delete(game);
      // A stopped match doesn't count unfinished games.
      if (this.stopped) break;
      this.record(board, game.result, game.reason ?? '');
    }
  }

  private record(board: MatchBoard, result: Result, reason: string) {
    board.result = result;
    this.dirty.add(board.slot);
    if (result === '*') return;
    const end = endKind(reason);
    this.tally.ends[end] = (this.tally.ends[end] ?? 0) + 1;
    this.tally.done++;
    if (result === '1/2-1/2') this.tally.draws++;
    else if ((result === '1-0') === board.aWhite) this.tally.aWins++;
    else this.tally.bWins++;
  }

  private flush(force = false) {
    if (!this.dirty.size && !force) return;
    const boards = [...this.dirty].map((s) => this.boards[s]);
    this.dirty.clear();
    this.onTick({ boards, tally: this.tally, running: this.running, error: this.error });
  }
}

/** Short category of a game's end reason, for the match summary. */
function endKind(reason: string) {
  if (/failed to start/.test(reason)) return 'failed to start';
  if (/crashed/.test(reason)) return 'crash';
  if (/illegal move/.test(reason)) return 'illegal move';
  if (/ran out of time/.test(reason)) return 'time';
  return reason || 'unknown';
}
