import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

export interface EngineDef {
  command: string;
  args: string[];
  options: Record<string, string | number | boolean>;
  cwd?: string;
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
  private proc: ChildProcessWithoutNullStreams | null = null;
  private waiters: Waiter[] = [];
  private info: SearchInfo = {};
  private exitReason: string | null = null;
  private stderrTail = '';

  constructor(private def: EngineDef) {}

  get alive() {
    return this.proc !== null && this.exitReason === null;
  }

  async start(timeoutMs = 10_000): Promise<void> {
    const wrongOs = foreignBinary(this.def.command);
    if (wrongOs) {
      this.fail(wrongOs);
      throw new EngineError(wrongOs);
    }
    const cwd = this.def.cwd ?? (path.isAbsolute(this.def.command) ? path.dirname(this.def.command) : undefined);
    const proc = spawn(this.def.command, this.def.args, { cwd, stdio: 'pipe' });
    this.proc = proc;
    proc.stdin.on('error', () => {});
    proc.stderr.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-400);
    });
    proc.on('error', (err) => this.fail(describeSpawnError(err)));
    proc.on('exit', (code, signal) => {
      const tail = this.stderrTail.trim().split('\n').pop();
      this.fail(`engine exited (${signal ?? `code ${code}`})${tail ? `: ${tail}` : ''}`);
    });
    createInterface({ input: proc.stdout }).on('line', (line) => this.onLine(line.trim()));

    this.send('uci');
    await this.waitFor((l) => l === 'uciok', timeoutMs, 'no uciok');
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
  async go(startFen: string, moves: string[], limits: GoLimits, hardLimitMs: number): Promise<{ move: string; info: SearchInfo }> {
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
    const proc = this.proc;
    this.send('quit');
    this.fail('quit');
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    }, 500).unref();
  }

  private send(cmd: string) {
    if (this.alive) this.proc!.stdin.write(cmd + '\n');
  }

  private onLine(line: string) {
    if (line.startsWith('id name ')) this.name = line.slice(8);
    else if (line.startsWith('id author ')) this.author = line.slice(10);
    else if (line.startsWith('info ')) this.parseInfo(line);
    const i = this.waiters.findIndex((w) => w.match(line));
    if (i >= 0) this.waiters.splice(i, 1)[0].resolve(line);
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

function describeSpawnError(err: NodeJS.ErrnoException): string {
  if (err.code === 'ENOENT') return 'file not found';
  if (err.code === 'EACCES') return 'not executable (chmod +x)';
  if (err.code === 'ENOEXEC' || /exec format/i.test(err.message))
    return 'wrong binary format — inside Docker engines must be Linux builds';
  return err.message;
}

/** Explains binaries built for another OS (e.g. a macOS engine inside the Linux container). */
function foreignBinary(command: string): string | null {
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
  const macho = ['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe'].includes(magic);
  if (macho && process.platform !== 'darwin') return 'this is a macOS binary; inside Docker the engine needs a Linux build';
  if (head.subarray(0, 2).toString() === 'MZ' && process.platform !== 'win32') return 'this is a Windows .exe; it needs a Linux build';
  if (magic === '7f454c46' && process.platform !== 'linux') return 'this is a Linux binary; run the app with Docker or use a native build';
  return null;
}
