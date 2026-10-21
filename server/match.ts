import type { EngineInfo, MatchBoard, MatchSummary, Result, Tally, TimeControl } from '../shared/protocol.js';
import { START_FEN } from '../shared/protocol.js';
import { EnginePlayer, Game } from './game.js';
import { UciEngine, type EngineDef } from './uci.js';

export interface MatchOptions {
  engineA: EngineInfo;
  engineB: EngineInfo;
  defA: EngineDef;
  defB: EngineDef;
  games: number;
  tc: TimeControl;
  /** Games played at the same time; each one is a board in the grid. */
  concurrency: number;
}

export interface MatchTick {
  boards: MatchBoard[];
  tally: Tally;
  running: boolean;
}

const TICK_MS = 100;

/**
 * Plays N games between engine A and engine B, `concurrency` at a time. Colors
 * swap every game. Each slot keeps one process per engine and plays its games
 * one after another.
 */
export class Match {
  readonly id = Math.random().toString(36).slice(2, 10);
  readonly boards: MatchBoard[];
  /** The game each board plays now (or played last). */
  readonly current: (Game | null)[];
  readonly tally: Tally;
  running = true;
  private next = 0;
  private stopped = false;
  private live = new Set<Game>();
  private engines = new Set<UciEngine>();
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
    this.tally = { aWins: 0, bWins: 0, draws: 0, done: 0, total: opts.games };
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
    };
  }

  async run() {
    await Promise.all(this.boards.map((b) => this.slot(b)));
    this.finish();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const g of this.live) g.stop();
    for (const e of this.engines) e.quit();
    this.finish();
  }

  private finish() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.flush(true);
  }

  private async slot(board: MatchBoard) {
    let a: UciEngine | null = null;
    let b: UciEngine | null = null;
    try {
      while (!this.stopped && this.next < this.opts.games) {
        const i = this.next++;
        const aWhite = i % 2 === 0;
        if (board.result !== '*') [board.last, board.lastAWhite] = [board.result, board.aWhite];
        Object.assign(board, { game: i, fen: START_FEN, lm: '', aWhite, result: '*' });
        this.dirty.add(board.slot);
        // (Re)start engines that are missing or died; one that can't start loses the game.
        let failed: 'a' | 'b' | null = null;
        try {
          a = await this.ensure(a, this.opts.defA);
        } catch {
          [failed, a] = ['a', null];
        }
        if (!failed) {
          try {
            b = await this.ensure(b, this.opts.defB);
          } catch {
            [failed, b] = ['b', null];
          }
        }
        if (this.stopped) break;
        if (failed) {
          this.record(board, (failed === 'b') === aWhite ? '1-0' : '0-1');
          continue;
        }

        const pa = new EnginePlayer(a!, this.opts.engineA.name, this.opts.engineA.id);
        const pb = new EnginePlayer(b!, this.opts.engineB.name, this.opts.engineB.id);
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
        if (this.stopped) break;
        this.record(board, game.result);
      }
    } finally {
      a?.quit();
      b?.quit();
    }
  }

  private async ensure(e: UciEngine | null, def: EngineDef): Promise<UciEngine> {
    if (e?.alive) {
      try {
        await e.newGame();
        return e;
      } catch {
        e.quit();
      }
    }
    if (e) this.engines.delete(e);
    const fresh = new UciEngine(def);
    this.engines.add(fresh);
    try {
      await fresh.start();
      await fresh.newGame();
    } catch (err) {
      fresh.quit();
      this.engines.delete(fresh);
      throw err;
    }
    return fresh;
  }

  private record(board: MatchBoard, result: Result) {
    board.result = result;
    this.dirty.add(board.slot);
    if (result === '*') return;
    this.tally.done++;
    if (result === '1/2-1/2') this.tally.draws++;
    else if ((result === '1-0') === board.aWhite) this.tally.aWins++;
    else this.tally.bWins++;
  }

  private flush(force = false) {
    if (!this.dirty.size && !force) return;
    const boards = [...this.dirty].map((s) => this.boards[s]);
    this.dirty.clear();
    this.onTick({ boards, tally: this.tally, running: this.running });
  }
}
