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
  /** For engines kept as versions (`engines/<family>/<version>/`): the engine's folder name. */
  family?: string;
  /** Version folder name, e.g. 'v3'. Versions sort by the number in it. */
  version?: string;
  /** Name of the version within its family: the folder name, or what it was renamed to. */
  label?: string;
  /** Elo range when the engine can play at a set strength (UCI_LimitStrength + UCI_Elo). */
  elo?: { min: number; max: number };
  /** Set when the engine runs on the engine host instead of the server, e.g. 'macOS'. */
  host?: string;
}

export type TimeControl =
  | { kind: 'clock'; baseMs: number; incMs: number }
  | { kind: 'movetime'; ms: number }
  /** No clock: every move is a search to this depth (engines with their own fixed depth use that). */
  | { kind: 'depth'; depth: number };

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
  fen: string;
  clock: { w: number; b: number; running: Color | null; tc: TimeControl };
  result: Result;
  reason?: string;
}

/** One board of the live grid: a parallel game slot and the game it plays now. */
export interface MatchBoard {
  slot: number;
  /** Game number (0-based), or -1 before the slot's first game. */
  game: number;
  fen: string;
  /** Last move as UCI, '' if none. */
  lm: string;
  /** True when engine A has White. */
  aWhite: boolean;
  /** Result of the game when it just ended, '*' while it runs. */
  result: Result;
  /** Result of the slot's previous game (shown briefly when the next one starts). */
  last: Result;
  /** Whether engine A had White in that previous game. */
  lastAWhite: boolean;
}

export interface Tally {
  aWins: number;
  bWins: number;
  draws: number;
  done: number;
  total: number;
  /** How games ended: 'checkmate', 'time', 'crash', … → count. */
  ends: Record<string, number>;
}

export interface MatchSummary {
  id: string;
  engineA: { id: string; name: string };
  engineB: { id: string; name: string };
  games: number;
  tc: TimeControl;
  concurrency: number;
  running: boolean;
  boards: MatchBoard[];
  tally: Tally;
  /** Why the match stopped early (e.g. an engine that can't start). */
  error?: string;
  /** Engine processes per engine; at most this many moves per engine are computed at once. */
  poolSize: number;
}

export type ClientMsg =
  | { t: 'engines.refresh' }
  | { t: 'engines.rename'; id: string; name: string }
  | { t: 'engines.remove'; id: string }
  /** `elo` sets an engine's strength per color; leave it out for full strength. */
  | { t: 'play.new'; white: PlayerRef; black: PlayerRef; tc: TimeControl; elo?: { w?: number; b?: number } }
  | { t: 'play.move'; gameId: string; uci: string }
  | { t: 'play.resign'; gameId: string }
  | { t: 'match.start'; engineA: string; engineB: string; eloA?: number; eloB?: number; games: number; tc: TimeControl; concurrency: number }
  | { t: 'match.stop' }
  /** Follow one board of the match in full (moves, clocks), or stop with null. */
  | { t: 'match.watch'; slot: number | null };

export type ServerMsg =
  | { t: 'hello'; cores: number }
  | { t: 'engines'; engines: EngineInfo[] }
  | { t: 'game'; game: GameState }
  | { t: 'match'; match: MatchSummary | null }
  /** Boards that changed and the new tally, batched every 100 ms. */
  | { t: 'match.tick'; id: string; boards: MatchBoard[]; tally: Tally; running: boolean; error?: string }
  /** Full state of the game on the watched board, on every move. */
  | { t: 'match.game'; id: string; slot: number; game: GameState }
  | { t: 'error'; message: string };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
