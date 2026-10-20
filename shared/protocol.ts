// Messages exchanged between the browser and the server over one WebSocket.

export type Color = 'w' | 'b';
export type Result = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface EngineInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  options: Record<string, string | number | boolean>;
  source: 'auto' | 'config';
  /** 'ok' once the engine answered `uciok`; otherwise the reason it failed. */
  status: 'ok' | 'error' | 'unknown';
  error?: string;
  author?: string;
}

export type TimeControl =
  | { kind: 'clock'; baseMs: number; incMs: number }
  | { kind: 'movetime'; ms: number };

/** 'human' or an engine id. */
export type PlayerRef = string;

export interface MoveRecord {
  uci: string;
  san: string;
  /** Centipawns from White's point of view, or mate distance (positive = White mates). */
  eval?: { cp?: number; mate?: number; depth?: number };
  ms?: number;
}

export interface GameState {
  id: string;
  white: { name: string; ref: PlayerRef };
  black: { name: string; ref: PlayerRef };
  startFen: string;
  moves: MoveRecord[];
  /** Number of plies in `moves` that came from the opening book. */
  bookPlies: number;
  fen: string;
  clock: { w: number; b: number; running: Color | null; tc: TimeControl };
  result: Result;
  reason?: string;
}

export type GameStatus = 'queued' | 'playing' | 'done';

/** Compact per-board info for the match grid. */
export interface BoardTick {
  i: number;
  fen: string;
  /** Last move as uci, '' if none. */
  lm: string;
  st: GameStatus;
  r: Result;
  /** True when engine A has White in this game. */
  aw: boolean;
}

export interface Tally {
  aWins: number;
  bWins: number;
  draws: number;
  done: number;
  total: number;
}

export interface MatchSummary {
  id: string;
  engineA: { id: string; name: string };
  engineB: { id: string; name: string };
  games: number;
  tc: TimeControl;
  concurrency: number;
  running: boolean;
  boards: BoardTick[];
  reasons: string[];
  tally: Tally;
}

export type ClientMsg =
  | { t: 'engines.refresh' }
  | { t: 'engines.add'; name: string; command: string; args?: string[] }
  | { t: 'engines.remove'; id: string }
  | { t: 'play.new'; white: PlayerRef; black: PlayerRef; tc: TimeControl }
  | { t: 'play.move'; gameId: string; uci: string }
  | { t: 'play.resign'; gameId: string }
  | { t: 'match.start'; engineA: string; engineB: string; games: number; tc: TimeControl; concurrency: number }
  | { t: 'match.stop' }
  | { t: 'watch'; gameId: string | null; matchIndex?: number };

export type ServerMsg =
  | { t: 'hello'; cores: number }
  | { t: 'engines'; engines: EngineInfo[] }
  | { t: 'game'; game: GameState }
  | { t: 'match'; match: MatchSummary | null }
  | { t: 'match.tick'; id: string; boards: BoardTick[]; tally: Tally; running: boolean; reasons?: Record<number, string> }
  | { t: 'error'; message: string };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
