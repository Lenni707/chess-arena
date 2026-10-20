import type { BoardTick, EngineInfo, MatchSummary, Tally, TimeControl } from '../shared/protocol.js';
import { START_FEN } from '../shared/protocol.js';
import { EnginePlayer, Game } from './game.js';
import { openingFor } from './openings.js';
import { UciEngine, type EngineDef } from './uci.js';

export interface MatchOptions {
  engineA: EngineInfo;
  engineB: EngineInfo;
  defA: EngineDef;
  defB: EngineDef;
  games: number;
  tc: TimeControl;
  concurrency: number;
}

export interface MatchTick {
  boards: BoardTick[];
  tally: Tally;
  running: boolean;
  reasons: Record<number, string>;
}

const TICK_MS = 100;

/** Runs N engine-vs-engine games, `concurrency` at a time. */
export class Match {
  readonly id = Math.random().toString(36).slice(2, 10);
  readonly boards: BoardTick[];
  readonly games: (Game | null)[];
  readonly reasons: string[];
  readonly tally: Tally;
  running = true;
  private next = 0;
  private stopped = false;
  private dirty = new Set<number>();
  private timer: NodeJS.Timeout;
  private engines: UciEngine[] = [];
  private seed = (Math.random() * 2 ** 31) | 0;

  constructor(
    readonly opts: MatchOptions,
    private onTick: (t: MatchTick) => void,
    private onGameUpdate: (g: Game) => void,
  ) {
    this.boards = Array.from({ length: opts.games }, (_, i) => ({
      i,
      fen: START_FEN,
      lm: '',
      st: 'queued' as const,
      r: '*' as const,
      aw: i % 2 === 0,
    }));
    this.games = Array(opts.games).fill(null);
    this.reasons = Array(opts.games).fill('');
    this.tally = { aWins: 0, bWins: 0, draws: 0, done: 0, total: opts.games };
    this.timer = setInterval(() => this.flush(), TICK_MS);
  }

  summary(): MatchSummary {
    const { engineA, engineB, games, tc, concurrency } = this.opts;
    return {
      id: this.id,
      engineA: { id: engineA.id, name: engineA.name },
      engineB: { id: engineB.id, name: engineB.name },
      games,
      tc,
      concurrency,
      running: this.running,
      boards: this.boards,
      reasons: this.reasons,
      tally: this.tally,
    };
  }

  async run() {
    const workers = Math.max(1, Math.min(this.opts.concurrency, this.opts.games));
    await Promise.all(Array.from({ length: workers }, () => this.worker()));
    this.finish();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const g of this.games) if (g && !g.over) g.stop();
    for (const e of this.engines) e.quit();
    this.finish();
  }

  private finish() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.flush(true);
  }

  private async worker() {
    let a: UciEngine | null = null;
    let b: UciEngine | null = null;
    try {
      while (!this.stopped && this.next < this.opts.games) {
        const i = this.next++;
        const aWhite = i % 2 === 0;
        // (Re)start engines that are missing or died; a failure loses this game.
        let failed: 'a' | 'b' | null = null;
        let error = '';
        try {
          a = await this.ensure(a, this.opts.defA);
        } catch (e) {
          failed = 'a';
          error = (e as Error).message;
          a = null;
        }
        if (!failed) {
          try {
            b = await this.ensure(b, this.opts.defB);
          } catch (e) {
            failed = 'b';
            error = (e as Error).message;
            b = null;
          }
        }
        if (this.stopped) break;
        if (failed) {
          const name = failed === 'a' ? this.opts.engineA.name : this.opts.engineB.name;
          const aWins = failed === 'b';
          this.record(i, aWins === aWhite ? '1-0' : '0-1', `${name} failed to start: ${error}`);
          continue;
        }

        const pa = new EnginePlayer(a!, this.opts.engineA.name, this.opts.engineA.id);
        const pb = new EnginePlayer(b!, this.opts.engineB.name, this.opts.engineB.id);
        const game = new Game(`${this.id}-${i}`, aWhite ? pa : pb, aWhite ? pb : pa, this.opts.tc, (g) => {
          const bd = this.boards[i];
          bd.fen = g.chess.fen();
          bd.lm = g.lastMove;
          this.dirty.add(i);
          this.onGameUpdate(g);
        });
        game.applyBook(openingFor(i, this.seed));
        this.games[i] = game;
        this.boards[i].st = 'playing';
        await game.run();
        if (this.stopped) break;
        this.record(i, game.result, game.reason ?? '');
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
    const fresh = new UciEngine(def);
    this.engines.push(fresh);
    try {
      await fresh.start();
      await fresh.newGame();
    } catch (err) {
      fresh.quit();
      throw err;
    }
    this.engines = this.engines.filter((x) => x.alive || x === fresh);
    return fresh;
  }

  private record(i: number, result: '1-0' | '0-1' | '1/2-1/2' | '*', reason: string) {
    const bd = this.boards[i];
    bd.st = 'done';
    bd.r = result;
    this.reasons[i] = reason;
    if (result === '*') return;
    this.tally.done++;
    if (result === '1/2-1/2') this.tally.draws++;
    else if ((result === '1-0') === bd.aw) this.tally.aWins++;
    else this.tally.bWins++;
    this.dirty.add(i);
  }

  private flush(force = false) {
    if (!this.dirty.size && !force) return;
    const idx = [...this.dirty];
    this.dirty.clear();
    const reasons: Record<number, string> = {};
    for (const i of idx) if (this.reasons[i]) reasons[i] = this.reasons[i];
    this.onTick({ boards: idx.map((i) => this.boards[i]), tally: this.tally, running: this.running, reasons });
  }
}
