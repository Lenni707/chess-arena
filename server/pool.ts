import { EngineError, UciEngine, type EngineDef, type GoLimits, type SearchInfo } from './uci.js';

/** Anything that can search a position: one engine process, or a pool of them. */
export interface Searcher {
  /** `started` is called when the search really begins (after any wait for a free engine). */
  go(startFen: string, moves: string[], limits: GoLimits, hardLimitMs: number, started?: () => void): Promise<{ move: string; info: SearchInfo }>;
  stop(): void;
}

/** Restarts of a dead process in a row that may fail before the pool gives up. */
const MAX_RESTART_FAILURES = 3;

/**
 * A fixed number of processes of one engine, shared by many games. A game borrows
 * an idle process for one move and gives it back, so 100 games on screen need only
 * as many processes as there are CPU cores. That keeps memory bounded and gives
 * every search a full core. UCI engines get the whole move list with each
 * `position` command, so any process can continue any game.
 */
export class EnginePool {
  private idle: UciEngine[] = [];
  private all = new Set<UciEngine>();
  private waiting: { resolve: (e: UciEngine) => void; reject: (err: Error) => void }[] = [];
  private closed = false;
  private restartFailures = 0;
  /** Set when the engine can no longer be started; the match should stop. */
  broken: string | null = null;
  onBroken: (reason: string) => void = () => {};

  constructor(
    private def: EngineDef,
    readonly size: number,
  ) {}

  /** Start all processes. Throws if the engine can't start at all. */
  async start() {
    const results = await Promise.allSettled(Array.from({ length: this.size }, () => this.spawn()));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (!this.all.size) throw new EngineError(failed ? (failed.reason as Error).message : 'no engine started');
    for (const r of results) {
      if (r.status === 'fulfilled') this.release(r.value);
      // Some started: replace the missing ones in the background.
      else this.restart();
    }
  }

  /** One handle per game, so stopping a game only stops that game's search. */
  searcher(): Searcher {
    let current: UciEngine | null = null;
    return {
      go: async (startFen, moves, limits, hardLimitMs, started) => {
        const eng = await this.acquire();
        current = eng;
        started?.();
        try {
          const res = await eng.go(startFen, moves, limits, hardLimitMs);
          current = null;
          this.release(eng);
          return res;
        } catch (err) {
          // Crashed, hung or stopped mid-search: don't reuse this process.
          current = null;
          this.discard(eng);
          throw err;
        }
      },
      stop: () => current?.stop(),
    };
  }

  close() {
    this.closed = true;
    for (const w of this.waiting.splice(0)) w.reject(new EngineError('match stopped'));
    for (const e of this.all) e.quit();
    this.all.clear();
    this.idle = [];
  }

  private acquire(): Promise<UciEngine> {
    if (this.broken) return Promise.reject(new EngineError(this.broken));
    const e = this.idle.pop();
    if (e) return Promise.resolve(e);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  private release(e: UciEngine) {
    if (this.closed || !e.alive) return this.discard(e);
    const next = this.waiting.shift();
    if (next) next.resolve(e);
    else this.idle.push(e);
  }

  private discard(e: UciEngine) {
    e.quit();
    if (!this.all.delete(e) || this.closed) return;
    this.restart();
  }

  private async restart() {
    if (this.closed || this.broken) return;
    try {
      const e = await this.spawn();
      this.restartFailures = 0;
      this.release(e);
    } catch (err) {
      if (this.closed) return;
      if (++this.restartFailures >= MAX_RESTART_FAILURES) {
        this.broken = `engine keeps failing to start: ${(err as Error).message}`;
        this.onBroken(this.broken);
        for (const w of this.waiting.splice(0)) w.reject(new EngineError(this.broken));
      } else {
        setTimeout(() => this.restart(), 1000).unref();
      }
    }
  }

  private async spawn() {
    const e = new UciEngine(this.def);
    try {
      await e.start();
      await e.newGame();
    } catch (err) {
      e.quit();
      throw err;
    }
    if (this.closed) {
      e.quit();
      throw new EngineError('pool closed');
    }
    this.all.add(e);
    return e;
  }
}
