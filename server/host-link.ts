import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { EngineDef, EngineProcess } from './uci.js';

/** File in the engines folder holding the secret the engine host requires. */
export const TOKEN_FILE = '.engine-host-token';
/** Marks paths inside the engines folder; the host swaps in its own path for it. */
const ENGINES = '$ENGINES/';

/**
 * Connection to the engine host (`host/engine-host.ts`), a small process on the
 * Mac that starts engines the Linux container can't run, such as macOS binaries.
 * Messages are JSON lines; engine I/O is relayed line by line.
 */
export class HostLink {
  connected = false;
  /** `process.platform` of the host, e.g. 'darwin'. */
  platform = '';
  /** Called when the link comes up or goes down. */
  onChange: () => void = () => {};
  private sock: net.Socket | null = null;
  private procs = new Map<number, EngineProcess>();
  private nextId = 1;
  private dir = '';
  private stopped = false;
  private lastProblem = '';

  /** Keep connecting to the host at `addr` ('host:port') until `stop()`. */
  start(addr: string, enginesDir: string) {
    const [host, port] = splitAddr(addr);
    this.dir = path.resolve(enginesDir);
    this.stopped = false;
    this.connect(host, port);
  }

  stop() {
    this.stopped = true;
    this.sock?.destroy();
  }

  spawn(def: EngineDef): EngineProcess {
    const id = this.nextId++;
    const ep: EngineProcess = {
      write: (line) => this.send({ t: 'in', id, line }),
      close: () => this.send({ t: 'quit', id }),
      onLine: () => {},
      onExit: () => {},
    };
    this.procs.set(id, ep);
    this.send({ t: 'spawn', id, command: this.toHost(def.command), args: def.args.map((a) => this.toHost(a)) });
    return ep;
  }

  private connect(host: string, port: number) {
    const sock = net.connect({ host, port });
    this.sock = sock;
    sock.setNoDelay(true);
    sock.on('connect', () => {
      let token = '';
      try {
        token = fs.readFileSync(path.join(this.dir, TOKEN_FILE), 'utf8').trim();
      } catch {
        this.problem(`engine host: no ${TOKEN_FILE} in ${this.dir}; is the host serving this engines folder?`);
      }
      this.send({ t: 'hello', token });
    });
    const lines = createInterface({ input: sock });
    // readline re-emits socket errors; the 'close' handler below deals with them.
    lines.on('error', () => {});
    lines.on('line', (line) => {
      let msg: HostMsg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      this.onMsg(msg, `${host}:${port}`);
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      this.sock = null;
      const was = this.connected;
      this.connected = false;
      for (const [id, ep] of this.procs) {
        this.procs.delete(id);
        ep.onExit('engine host disconnected');
      }
      if (was) {
        console.log('engine host disconnected');
        this.onChange();
      }
      if (!this.stopped) setTimeout(() => this.connect(host, port), 2000).unref();
    });
  }

  private onMsg(msg: HostMsg, where: string) {
    switch (msg.t) {
      case 'ready':
        this.connected = true;
        this.platform = msg.platform;
        this.lastProblem = '';
        console.log(`engine host connected (${where}, ${msg.platform}/${msg.arch})`);
        this.onChange();
        break;
      case 'denied':
        this.problem(`engine host refused the connection: ${msg.reason}`);
        break;
      case 'out':
        this.procs.get(msg.id)?.onLine(msg.line);
        break;
      case 'exit': {
        const ep = this.procs.get(msg.id);
        this.procs.delete(msg.id);
        ep?.onExit(msg.reason);
        break;
      }
    }
  }

  private send(msg: object) {
    if (this.sock?.writable) this.sock.write(JSON.stringify(msg) + '\n');
  }

  /** Log a connection problem once, not on every retry. */
  private problem(text: string) {
    if (text !== this.lastProblem) console.warn(text);
    this.lastProblem = text;
  }

  private toHost(p: string) {
    const rel = path.relative(this.dir, p);
    if (!path.isAbsolute(p) || rel.startsWith('..') || path.isAbsolute(rel)) return p;
    return ENGINES + rel.split(path.sep).join('/');
  }
}

type HostMsg =
  | { t: 'ready'; platform: string; arch: string }
  | { t: 'denied'; reason: string }
  | { t: 'out'; id: number; line: string }
  | { t: 'exit'; id: number; reason: string };

function splitAddr(addr: string): [string, number] {
  const i = addr.lastIndexOf(':');
  return i < 0 ? [addr, 7100] : [addr.slice(0, i), Number(addr.slice(i + 1))];
}

export const engineHost = new HostLink();
