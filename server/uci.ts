import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { engineHost } from './host-link.js';

export interface EngineDef {
  command: string;
  args: string[];
  options: Record<string, string | number | boolean>;
  cwd?: string;
  /** Run on the engine host (your Mac) even if the container could run it. */
  host?: boolean;
}

/** A running engine process, local or on the engine host. Lines are without '\n'. */
export interface EngineProcess {
  write(line: string): void;
  /** Send `quit`, then kill the process if it hasn't exited shortly after. */
  close(): void;
  onLine: (line: string) => void;
  /** Called once when the process is gone, with a human-readable reason. */
  onExit: (reason: string) => void;
}

export interface SearchInfo {
  cp?: number;
  mate?: number;
  depth?: number;
}

export interface GoLimits {
  wtime?: number;
  btime?: number;
  winc?: number;
  binc?: number;
  movetime?: number;
}

export class EngineError extends Error {}

type Waiter = { match: (line: string) => boolean; resolve: (line: string) => void; reject: (e: Error) => void };

/** One running UCI engine process. */
export class UciEngine {
  name = '';
  author = '';
  /** Range of `UCI_Elo` when the engine can limit its strength (`UCI_LimitStrength`). */
  eloRange: { min: number; max: number } | null = null;
  private limitStrength = false;
  /** True when the engine runs on the engine host instead of in this process's OS. */
  onHost = false;
  private proc: EngineProcess | null = null;
  private waiters: Waiter[] = [];
  private info: SearchInfo = {};
  private exitReason: string | null = null;

  constructor(private def: EngineDef) {}

  get alive() {
    return this.proc !== null && this.exitReason === null;
  }

  async start(timeoutMs = 10_000): Promise<void> {
    try {
      this.onHost = runsOnHost(this.def);
    } catch (err) {
      this.fail((err as Error).message);
      throw err;
    }
    const proc = this.onHost ? engineHost.spawn(this.def) : spawnLocal(this.def);
    this.proc = proc;
    proc.onLine = (line) => this.onLine(line.trim());
    proc.onExit = (reason) => this.fail(reason);

    this.send('uci');
    await this.waitFor((l) => l === 'uciok', timeoutMs, 'no uciok');
    if (!this.limitStrength) this.eloRange = null;
    for (const [k, v] of Object.entries(this.def.options)) this.send(`setoption name ${k} value ${v}`);
    await this.ready(timeoutMs);
  }

  async ready(timeoutMs = 10_000) {
    this.send('isready');
    await this.waitFor((l) => l === 'readyok', timeoutMs, 'no readyok');
  }

  async newGame() {
    // `stop` flushes any search left over from an aborted game; harmless when idle.
    this.send('stop');
    this.send('ucinewgame');
    await this.ready();
  }

  /**
   * Search the position and return the best move. Rejects if the engine doesn't
   * answer within `hardLimitMs`; the caller decides what that means (usually a loss).
   */
  async go(startFen: string, moves: string[], limits: GoLimits, hardLimitMs: number, started?: () => void): Promise<{ move: string; info: SearchInfo }> {
    started?.();
    this.info = {};
    const pos = startFen === 'startpos' ? 'startpos' : `fen ${startFen}`;
    this.send(`position ${pos}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
    const parts = Object.entries(limits)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k} ${Math.max(0, Math.round(v as number))}`);
    this.send(`go ${parts.join(' ')}`);
    const line = await this.waitFor((l) => l.startsWith('bestmove'), hardLimitMs, 'no bestmove in time');
    const move = line.split(/\s+/)[1] ?? '';
    return { move, info: { ...this.info } };
  }

  /** Cancel a pending search (used when a human resigns etc.). */
  stop() {
    this.send('stop');
  }

  quit() {
    if (!this.proc) return;
    if (this.alive) this.proc.close();
    this.fail('quit');
  }

  private send(cmd: string) {
    if (this.alive) this.proc!.write(cmd);
  }

  private onLine(line: string) {
    if (line.startsWith('id name ')) this.name = line.slice(8);
    else if (line.startsWith('id author ')) this.author = line.slice(10);
    else if (line.startsWith('info ')) this.parseInfo(line);
    else if (line.startsWith('option name ')) this.parseOption(line);
    const i = this.waiters.findIndex((w) => w.match(line));
    if (i >= 0) this.waiters.splice(i, 1)[0].resolve(line);
  }

  /** Notes the options for playing at a set Elo; others are ignored. */
  private parseOption(line: string) {
    const m = line.match(/^option name (.+?) type (\S+)(.*)$/);
    if (!m) return;
    if (m[1] === 'UCI_LimitStrength') this.limitStrength = true;
    if (m[1] === 'UCI_Elo') {
      const min = Number(m[3].match(/\bmin (-?\d+)/)?.[1]);
      const max = Number(m[3].match(/\bmax (-?\d+)/)?.[1]);
      if (min > 0 && max > min) this.eloRange = { min, max };
    }
  }

  private parseInfo(line: string) {
    // Ignore bound-only / multipv>1 lines; keep the latest main-line score.
    const tok = line.split(/\s+/);
    if (tok.includes('lowerbound') || tok.includes('upperbound')) return;
    const mpv = tok.indexOf('multipv');
    if (mpv >= 0 && tok[mpv + 1] !== '1') return;
    const d = tok.indexOf('depth');
    const s = tok.indexOf('score');
    if (s < 0) return;
    const info: SearchInfo = {};
    if (d >= 0) info.depth = Number(tok[d + 1]);
    if (tok[s + 1] === 'cp') info.cp = Number(tok[s + 2]);
    else if (tok[s + 1] === 'mate') info.mate = Number(tok[s + 2]);
    this.info = info;
  }

  private waitFor(match: (l: string) => boolean, timeoutMs: number, what: string): Promise<string> {
    if (this.exitReason) return Promise.reject(new EngineError(this.exitReason));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve: (l) => {
          clearTimeout(timer);
          resolve(l);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new EngineError(what));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  private fail(reason: string) {
    if (this.exitReason) return;
    this.exitReason = reason;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(new EngineError(reason));
  }
}

/** Start an engine as a child process of this server. */
function spawnLocal(def: EngineDef): EngineProcess {
  const proc = spawn(def.command, def.args, { cwd: def.cwd ?? engineDir(def), stdio: 'pipe' });
  let stderrTail = '';
  let exited = false;
  const ep: EngineProcess = {
    write: (line) => {
      if (!exited) proc.stdin.write(line + '\n');
    },
    close: () => {
      ep.write('quit');
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
      }, 500).unref();
    },
    onLine: () => {},
    onExit: () => {},
  };
  const exit = (reason: string) => {
    if (exited) return;
    exited = true;
    ep.onExit(reason);
  };
  proc.stdin.on('error', () => {});
  proc.stderr.on('data', (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-400);
  });
  proc.on('error', (err) => exit(describeSpawnError(err)));
  proc.on('exit', (code, signal) => {
    const tail = stderrTail.trim().split('\n').pop();
    exit(`engine exited (${signal ?? `code ${code}`})${tail ? `: ${tail}` : ''}`);
  });
  createInterface({ input: proc.stdout }).on('line', (line) => ep.onLine(line));
  return ep;
}

/** The engine's own folder (for scripts, the script's), so it finds files next to it. */
export function engineDir(def: EngineDef): string | undefined {
  const file = path.isAbsolute(def.command) ? def.command : def.args[0];
  return file && path.isAbsolute(file) ? path.dirname(file) : undefined;
}

const START_HOST = 'start the engine host on your Mac with `npm run engine-host`';

/** Decide where the engine runs; throws when it can't run anywhere right now. */
function runsOnHost(def: EngineDef): boolean {
  if (def.host) {
    if (!engineHost.connected) throw new EngineError(`set to run on the engine host, which isn't connected: ${START_HOST}`);
    return true;
  }
  const kind = binaryKind(def.command);
  if (kind === 'macos' && process.platform !== 'darwin') {
    if (engineHost.connected && engineHost.platform === 'darwin') return true;
    throw new EngineError(`this is a macOS binary; to run it from Docker, ${START_HOST}`);
  }
  if (kind === 'windows' && process.platform !== 'win32') throw new EngineError('this is a Windows .exe; it needs a Linux or macOS build');
  if (kind === 'linux' && process.platform !== 'linux') throw new EngineError('this is a Linux binary; run the app with Docker or use a native build');
  return false;
}

function describeSpawnError(err: NodeJS.ErrnoException): string {
  if (err.code === 'ENOENT') return 'file not found';
  if (err.code === 'EACCES') return 'not executable (chmod +x)';
  if (err.code === 'ENOEXEC' || /exec format/i.test(err.message))
    return 'wrong binary format: inside Docker an engine must be a Linux build (or a macOS build run by the engine host)';
  return err.message;
}

/** Which OS an executable was built for, from its first bytes. */
function binaryKind(command: string): 'macos' | 'windows' | 'linux' | null {
  if (!path.isAbsolute(command)) return null;
  let head: Buffer;
  try {
    const fd = fs.openSync(command, 'r');
    head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  const magic = head.toString('hex');
  if (['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe'].includes(magic)) return 'macos';
  if (head.subarray(0, 2).toString() === 'MZ') return 'windows';
  if (magic === '7f454c46') return 'linux';
  return null;
}
