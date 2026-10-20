import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { EngineInfo } from '../shared/protocol.js';
import { UciEngine, type EngineDef } from './uci.js';

interface ConfigEntry {
  name?: string;
  command: string;
  args?: string[];
  options?: Record<string, string | number | boolean>;
}

const SKIP = /\.(json|md|txt|nnue|bin|dll|so|dylib|pdf|png|jpg|zip|tar|gz|ini|cfg|log)$/i;

/** Finds engines in the engines directory and keeps `engines.json` in sync. */
export class EngineRegistry {
  private engines: EngineInfo[] = [];
  private probeCache = new Map<string, Pick<EngineInfo, 'status' | 'error' | 'author'> & { uciName?: string }>();

  constructor(readonly dir: string) {}

  list() {
    return this.engines;
  }

  get(id: string) {
    return this.engines.find((e) => e.id === id);
  }

  def(e: EngineInfo): EngineDef {
    return { command: e.command, args: e.args, options: e.options };
  }

  async refresh(): Promise<EngineInfo[]> {
    await fs.mkdir(this.dir, { recursive: true });
    const config = await this.readConfig();
    const found: EngineInfo[] = config.map((c) => ({
      id: idFor(c.command, c.args ?? []),
      name: c.name ?? path.basename(c.command),
      command: this.resolve(c.command),
      args: c.args ?? [],
      options: c.options ?? {},
      source: 'config',
      status: 'unknown',
    }));
    const configured = new Set(found.map((e) => e.command));
    for (const cmd of await this.scan()) {
      if (configured.has(cmd.command)) continue;
      found.push({
        id: idFor(cmd.command, cmd.args),
        name: path.basename(cmd.file).replace(/\.(py|js|mjs|sh)$/, ''),
        command: cmd.command,
        args: cmd.args,
        options: {},
        source: 'auto',
        status: 'unknown',
      });
    }
    await Promise.all(found.map((e) => this.probe(e)));
    this.engines = found;
    return found;
  }

  /**
   * Save a file picked in the browser into the engines folder. Files of a
   * multi-file pick share a subfolder so an engine finds its network files.
   */
  async saveUpload(folder: string, name: string, body: Readable) {
    const dir = folder ? path.join(this.dir, safeName(folder)) : this.dir;
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, safeName(name));
    await pipeline(body, createWriteStream(file));
    if (!SKIP.test(file)) await fs.chmod(file, 0o755);
  }

  async remove(id: string) {
    const e = this.get(id);
    if (!e) return this.engines;
    if (e.source === 'config') {
      const config = await this.readConfig();
      await this.writeConfig(config.filter((c) => idFor(c.command, c.args ?? []) !== id));
    } else {
      // Found by scanning: delete the engine file itself (for scripts, the script).
      const file = path.isAbsolute(e.command) ? e.command : e.args[0];
      if (file && path.resolve(file).startsWith(this.dir + path.sep)) await fs.rm(file, { force: true });
    }
    return this.refresh();
  }

  private resolve(command: string) {
    if (path.isAbsolute(command) || !command.includes('/')) return command;
    return path.resolve(this.dir, command);
  }

  private async scan() {
    const out: { file: string; command: string; args: string[] }[] = [];
    const visit = async (dir: string, depth: number) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (ent.name.startsWith('.') || SKIP.test(ent.name)) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (depth === 0) await visit(full, 1);
          continue;
        }
        const st = await fs.stat(full).catch(() => null);
        if (!st?.isFile()) continue;
        if (/\.py$/.test(ent.name)) out.push({ file: full, command: 'python3', args: [full] });
        else if (/\.m?js$/.test(ent.name)) out.push({ file: full, command: 'node', args: [full] });
        else if (st.mode & 0o111) out.push({ file: full, command: full, args: [] });
      }
    };
    await visit(this.dir, 0);
    return out;
  }

  private async probe(e: EngineInfo) {
    const key = `${e.command}\0${e.args.join('\0')}\0${await mtime(e.command)}\0${e.args[0] ? await mtime(e.args[0]) : ''}`;
    let res = this.probeCache.get(key);
    if (!res) {
      const eng = new UciEngine({ command: e.command, args: e.args, options: {} });
      try {
        await eng.start(5000);
        res = { status: 'ok', author: eng.author || undefined, uciName: eng.name || undefined };
      } catch (err) {
        res = { status: 'error', error: (err as Error).message };
      } finally {
        eng.quit();
      }
      this.probeCache.set(key, res);
    }
    e.status = res.status;
    e.error = res.error;
    e.author = res.author;
    if (e.source === 'auto' && res.uciName) e.name = res.uciName;
  }

  private async readConfig(): Promise<ConfigEntry[]> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.dir, 'engines.json'), 'utf8'));
      return Array.isArray(raw) ? raw.filter((c) => typeof c?.command === 'string') : [];
    } catch {
      return [];
    }
  }

  private async writeConfig(config: ConfigEntry[]) {
    await fs.writeFile(path.join(this.dir, 'engines.json'), JSON.stringify(config, null, 2) + '\n');
  }
}

function safeName(name: string) {
  const base = path.basename(name).replace(/[^\w.+-]/g, '_');
  return base.replace(/^\.+/, '') || 'engine';
}

function idFor(command: string, args: string[]) {
  return createHash('sha1').update([command, ...args].join('\0')).digest('hex').slice(0, 10);
}

async function mtime(p: string) {
  const st = await fs.stat(p).catch(() => null);
  return st ? st.mtimeMs : 0;
}
