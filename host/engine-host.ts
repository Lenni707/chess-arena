// Engine host: run this on your Mac, next to the Docker container.
//
//   npm run engine-host        (or: node host/engine-host.ts)
//
// The server in the container connects here (host.docker.internal:7100) to start
// engines the Linux container can't run, such as native macOS binaries. Only files
// inside the engines folder (and node/python3 scripts in it) can be started, and
// the server must present the token from `engines/.engine-host-token`, which only
// it and you can read. No dependencies, so it runs with plain Node 22.18+.

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.ENGINE_HOST_PORT ?? 7100);
const BIND = process.env.ENGINE_HOST_BIND ?? '127.0.0.1';
const DIR = fs.realpathSync(path.resolve(process.env.ENGINES_DIR ?? 'engines'));
const TOKEN_FILE = path.join(DIR, '.engine-host-token');
const INTERPRETERS = new Set(['node', 'python3']);

const token = readToken();

const server = net.createServer((sock) => {
  sock.setNoDelay(true);
  const procs = new Map<number, ChildProcess>();
  let authed = false;
  const send = (msg: object) => {
    if (sock.writable) sock.write(JSON.stringify(msg) + '\n');
  };

  const lines = createInterface({ input: sock });
  lines.on('error', () => {});
  lines.on('line', (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!authed) {
      if (msg.t === 'hello' && sameToken(String(msg.token ?? ''))) {
        authed = true;
        send({ t: 'ready', platform: process.platform, arch: process.arch });
        log(`server connected from ${sock.remoteAddress}`);
      } else {
        send({ t: 'denied', reason: 'wrong token (is the server using the same engines folder?)' });
        sock.end();
      }
      return;
    }
    if (msg.t === 'spawn') start(Number(msg.id), String(msg.command), (msg.args ?? []).map(String));
    else if (msg.t === 'in') procs.get(msg.id)?.stdin?.write(msg.line + '\n');
    else if (msg.t === 'quit') {
      const p = procs.get(msg.id);
      p?.stdin?.write('quit\n');
      setTimeout(() => p && p.exitCode === null && p.signalCode === null && p.kill('SIGKILL'), 500).unref();
    }
  });

  function start(id: number, command: string, args: string[]) {
    const exit = (reason: string) => {
      if (!procs.has(id)) return;
      procs.delete(id);
      send({ t: 'exit', id, reason });
    };
    let file: string, cmd: string;
    try {
      cmd = INTERPRETERS.has(command) ? command : inside(command);
      args = args.map((a) => (a.startsWith('$ENGINES/') ? inside(a) : a));
      file = cmd === command ? args[0] : cmd;
      if (!file || !isInside(file)) throw new Error('only engines inside the engines folder can be started');
    } catch (err) {
      log(`refused to start ${command}: ${(err as Error).message}`);
      send({ t: 'exit', id, reason: `engine host refused: ${(err as Error).message}` });
      return;
    }
    const proc = spawn(cmd, args, { cwd: path.dirname(file), stdio: 'pipe' });
    procs.set(id, proc);
    let stderrTail = '';
    proc.stdin.on('error', () => {});
    proc.stderr.on('data', (d: Buffer) => (stderrTail = (stderrTail + d.toString()).slice(-400)));
    createInterface({ input: proc.stdout }).on('line', (line) => send({ t: 'out', id, line }));
    proc.on('error', (err: NodeJS.ErrnoException) =>
      exit(err.code === 'ENOENT' ? 'file not found' : err.code === 'EACCES' ? 'not executable (chmod +x)' : err.message),
    );
    proc.on('exit', (code, signal) => {
      const tail = stderrTail.trim().split('\n').pop();
      exit(`engine exited (${signal ?? `code ${code}`})${tail ? `: ${tail}` : ''}`);
    });
    log(`started ${path.relative(DIR, file)}`);
  }

  sock.on('error', () => {});
  sock.on('close', () => {
    for (const p of procs.values()) p.kill('SIGKILL');
    procs.clear();
    if (authed) log('server disconnected');
  });
});

server.listen(PORT, BIND, () => {
  log(`engine host on ${BIND}:${PORT}, serving ${DIR} (${os.platform()}/${os.arch()})`);
});

/** `$ENGINES/x/y` → absolute path inside DIR (symlinks resolved); throws if it escapes. */
function inside(p: string) {
  if (!p.startsWith('$ENGINES/')) throw new Error(`${p} is not in the engines folder`);
  const full = path.resolve(DIR, p.slice('$ENGINES/'.length));
  if (!isInside(full)) throw new Error(`${p} is not in the engines folder`);
  return full;
}

function isInside(p: string) {
  let real: string;
  try {
    real = fs.realpathSync(p);
  } catch {
    return false;
  }
  const rel = path.relative(DIR, real);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  } catch {}
  const t = randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  return t;
}

function sameToken(t: string) {
  const a = Buffer.from(t);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function log(s: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${s}`);
}
