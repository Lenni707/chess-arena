import type { Color, GameState, MoveRecord, Result, TimeControl } from '../shared/protocol.js';
import { START_FEN } from '../shared/protocol.js';
import { Position } from './chess.js';
import { EngineError, UciEngine, type SearchInfo } from './uci.js';

export interface MoveRequest {
  moves: string[];
  color: Color;
  /** Remaining clock times at the start of this move. */
  wtime: number;
  btime: number;
  tc: TimeControl;
}

export interface Player {
  name: string;
  ref: string;
  /** Resolves with a uci move; rejects with EngineError when the player can't move. */
  move(req: MoveRequest): Promise<{ uci: string; info?: SearchInfo }>;
  /** Abort a pending `move` call. */
  cancel(): void;
}

/** Hang allowance on top of the clock before an engine is declared lost. */
const HANG_MS = 1500;
/** Over-use of the clock tolerated before flagging (process + IPC overhead). */
const TIME_MARGIN_MS = 30;

export class EnginePlayer implements Player {
  ref: string;
  constructor(readonly engine: UciEngine, public name: string, ref: string) {
    this.ref = ref;
  }

  async move(req: MoveRequest) {
    if (req.tc.kind === 'movetime') {
      return this.toResult(await this.engine.go('startpos', req.moves, { movetime: req.tc.ms }, req.tc.ms + 5000));
    }
    const own = req.color === 'w' ? req.wtime : req.btime;
    const res = await this.engine.go(
      'startpos',
      req.moves,
      { wtime: req.wtime, btime: req.btime, winc: req.tc.incMs, binc: req.tc.incMs },
      own + HANG_MS,
    );
    return this.toResult(res);
  }

  private toResult(r: { move: string; info: SearchInfo }) {
    return { uci: r.move, info: r.info };
  }

  cancel() {
    this.engine.stop();
  }
}

export class HumanPlayer implements Player {
  ref = 'human';
  name = 'You';
  private pending: { resolve: (m: { uci: string }) => void; reject: (e: Error) => void } | null = null;

  move() {
    return new Promise<{ uci: string }>((resolve, reject) => (this.pending = { resolve, reject }));
  }

  /** Called when the browser sends a move. */
  submit(uci: string) {
    const p = this.pending;
    this.pending = null;
    p?.resolve({ uci });
  }

  get waiting() {
    return this.pending !== null;
  }

  cancel() {
    const p = this.pending;
    this.pending = null;
    p?.reject(new Error('cancelled'));
  }
}

export class Game {
  readonly pos = new Position();
  readonly moves: MoveRecord[] = [];
  readonly uci: string[] = [];
  result: Result = '*';
  reason?: string;
  private clock: { w: number; b: number };
  private turnStart = 0;
  private running: Color | null = null;
  private stopped = false;
  private flagTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly id: string,
    readonly white: Player,
    readonly black: Player,
    readonly tc: TimeControl,
    private onUpdate: (g: Game) => void = () => {},
  ) {
    this.clock = tc.kind === 'clock' ? { w: tc.baseMs, b: tc.baseMs } : { w: 0, b: 0 };
  }

  get over() {
    return this.result !== '*';
  }

  get lastMove() {
    return this.uci[this.uci.length - 1] ?? '';
  }

  state(): GameState {
    const clock = { ...this.clock };
    if (this.running && this.tc.kind === 'clock') clock[this.running] -= Date.now() - this.turnStart;
    return {
      id: this.id,
      white: { name: this.white.name, ref: this.white.ref },
      black: { name: this.black.name, ref: this.black.ref },
      startFen: START_FEN,
      moves: this.moves,
      fen: this.pos.fen(),
      clock: { ...clock, running: this.running, tc: this.tc },
      result: this.result,
      reason: this.reason,
    };
  }

  async run(): Promise<Result> {
    this.onUpdate(this);
    this.checkEnd();
    while (!this.over && !this.stopped) {
      const color = this.pos.turn() as Color;
      const player = color === 'w' ? this.white : this.black;
      const other = color === 'w' ? 'black' : 'white';
      this.running = color;
      this.turnStart = Date.now();
      this.onUpdate(this);

      if (player instanceof HumanPlayer && this.tc.kind === 'clock') {
        this.flagTimer = setTimeout(() => this.flag(color), this.clock[color] + TIME_MARGIN_MS);
      }
      let res: { uci: string; info?: SearchInfo };
      try {
        res = await player.move({ moves: [...this.uci], color, wtime: this.clock.w, btime: this.clock.b, tc: this.tc });
      } catch (err) {
        if (this.over || this.stopped) break;
        const msg = (err as Error).message;
        if (err instanceof EngineError && /in time/.test(msg)) this.flag(color);
        else this.finish(color === 'w' ? '0-1' : '1-0', `${player.name} crashed: ${msg}`);
        break;
      } finally {
        if (this.flagTimer) clearTimeout(this.flagTimer);
        this.flagTimer = null;
      }
      if (this.over || this.stopped) break;

      const elapsed = Date.now() - this.turnStart;
      if (this.tc.kind === 'clock') {
        this.clock[color] -= elapsed;
        if (this.clock[color] < -TIME_MARGIN_MS) {
          this.flag(color);
          break;
        }
        this.clock[color] = Math.max(0, this.clock[color]) + this.tc.incMs;
      }
      if (!this.apply(res.uci, res.info, elapsed)) {
        this.finish(color === 'w' ? '0-1' : '1-0', `${player.name} played an illegal move (${res.uci || 'none'}); ${other} wins`);
        break;
      }
      this.checkEnd();
    }
    this.running = null;
    this.onUpdate(this);
    return this.result;
  }

  /** Resign, abort or adjudicate from outside. */
  end(result: Result, reason: string) {
    if (this.over) return;
    this.finish(result, reason);
    this.white.cancel();
    this.black.cancel();
    this.onUpdate(this);
  }

  stop() {
    this.stopped = true;
    if (this.flagTimer) clearTimeout(this.flagTimer);
    this.white.cancel();
    this.black.cancel();
  }

  private apply(uci: string, info?: SearchInfo, ms?: number): boolean {
    const color = this.pos.turn();
    let san: string;
    try {
      san = this.pos.play(uci);
    } catch {
      return false;
    }
    const rec: MoveRecord = { uci, san };
    if (ms !== undefined) rec.ms = ms;
    if (info && (info.cp !== undefined || info.mate !== undefined)) {
      // Engines report the score for the side to move; store it from White's view.
      const sign = color === 'w' ? 1 : -1;
      rec.eval = { depth: info.depth };
      if (info.cp !== undefined) rec.eval.cp = sign * info.cp;
      if (info.mate !== undefined) rec.eval.mate = sign * info.mate;
    }
    this.moves.push(rec);
    this.uci.push(uci);
    return true;
  }

  private checkEnd() {
    const reason = this.pos.outcome();
    if (!reason) return;
    // Checkmate: the side to move is mated. Everything else is a draw.
    if (reason === 'checkmate') this.finish(this.pos.turn() === 'w' ? '0-1' : '1-0', reason);
    else this.finish('1/2-1/2', reason);
  }

  private flag(color: Color) {
    if (this.over) return;
    if (this.tc.kind === 'clock') this.clock[color] = 0;
    const winner = color === 'w' ? 'b' : 'w';
    const loserName = (color === 'w' ? this.white : this.black).name;
    if (this.pos.hasInsufficientMaterial(winner)) this.finish('1/2-1/2', `${loserName} ran out of time vs. insufficient material`);
    else this.finish(winner === 'w' ? '1-0' : '0-1', `${loserName} ran out of time`);
    (color === 'w' ? this.white : this.black).cancel();
    this.onUpdate(this);
  }

  private finish(result: Result, reason: string) {
    if (this.over) return;
    if (this.running && this.tc.kind === 'clock' && this.clock[this.running] > 0) {
      this.clock[this.running] = Math.max(0, this.clock[this.running] - (Date.now() - this.turnStart));
    }
    this.result = result;
    this.reason = reason;
    this.running = null;
  }
}
