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
  /** Set when the engine runs on the engine host instead of the server, e.g. 'macOS'. */
  host?: string;
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
  fen: string;
  clock: { w: number; b: number; running: Color | null; tc: TimeControl };
  result: Result;
  reason?: string;
}

export type ClientMsg =
  | { t: 'engines.refresh' }
  | { t: 'engines.rename'; id: string; name: string }
  | { t: 'engines.remove'; id: string }
  | { t: 'play.new'; white: PlayerRef; black: PlayerRef; tc: TimeControl }
  | { t: 'play.move'; gameId: string; uci: string }
  | { t: 'play.resign'; gameId: string };

export type ServerMsg =
  | { t: 'hello'; cores: number }
  | { t: 'engines'; engines: EngineInfo[] }
  | { t: 'game'; game: GameState }
  | { t: 'error'; message: string };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
