import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { EngineInfo } from '../shared/protocol.js';
import { UciEngine, type EngineDef } from './uci.js';
import { engineHost } from './host-link.js';

interface ConfigEntry {
  name?: string;
  command: string;
  args?: string[];
  options?: Record<string, string | number | boolean>;
  /** Always run on the engine host (your Mac), not in the container. */
  host?: boolean;
}

const PLATFORMS: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

const SKIP = /\.(json|md|txt|nnue|bin|dll|so|dylib|pdf|png|jpg|zip|tar|gz|ini|cfg|log)$/i;

/** Finds engines in the engines directory and keeps `engines.json` in sync. */
export class EngineRegistry {
  private engines: EngineInfo[] = [];
  private probeCache = new Map<string, Pick<EngineInfo, 'status' | 'error' | 'author' | 'host'> & { uciName?: string }>();
  /** Engines that must run on the engine host, by id (from `engines.json`). */
  private hostOnly = new Set<string>();

  constructor(readonly dir: string) {}

  list() {
    return this.engines;
  }

  get(id: string) {
    return this.engines.find((e) => e.id === id);
  }

  def(e: EngineInfo): EngineDef {
    return { command: e.command, args: e.args, options: e.options, host: this.hostOnly.has(e.id) };
  }

  async refresh(): Promise<EngineInfo[]> {
    await fs.mkdir(this.dir, { recursive: true });
    const config = await this.readConfig();
    this.hostOnly = new Set(config.filter((c) => c.host).map((c) => this.idOf(c)));
    const found: EngineInfo[] = config.map((c) => {
      const command = this.resolve(c.command);
      const args = c.args ?? [];
      const e: EngineInfo = { id: this.idOf(c), name: c.name ?? path.basename(c.command), command, args, options: c.options ?? {}, source: 'config', status: 'unknown' };
      return this.withVersion(e, c.name);
    });
    const configured = new Set(found.map((e) => e.id));
    for (const cmd of await this.scan()) {
      if (configured.has(idFor(cmd.command, cmd.args))) continue;
      found.push(
        this.withVersion({
          id: idFor(cmd.command, cmd.args),
          name: stem(cmd.file),
          command: cmd.command,
          args: cmd.args,
          options: {},
          source: 'auto',
          status: 'unknown',
        }),
      );
    }
    await Promise.all(found.map((e) => this.probe(e)));
    // Families together, newest version first.
    found.sort((a, b) => (a.family ?? a.name).localeCompare(b.family ?? b.name) || versionNum(b.version) - versionNum(a.version));
    this.engines = found;
    return found;
  }

  /**
   * Save a file picked in the browser as (part of) version `version` of engine
   * `family`, in `engines/<family>/<version>/`. All files of one pick go into the
   * same version folder, so an engine finds its network files next to it.
   */
  async saveUpload(family: string, version: string, name: string, body: Readable) {
    family = safeName(family);
    await this.makeVersioned(family);
    const dir = path.join(this.dir, family, safeName(version));
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, safeName(name));
    await pipeline(body, createWriteStream(file));
    if (!SKIP.test(file)) await fs.chmod(file, 0o755);
  }

  /**
   * An engine kept the old way (a file in `engines/`, or files directly in
   * `engines/<family>/`) moves into `engines/<family>/v1/` before its next version
   * is added. `engines.json` entries pointing at the moved files are updated.
   */
  private async makeVersioned(family: string) {
    const legacy = this.engines.filter((e) => e.family === family && !e.version);
    if (!legacy.length) return;
    const famDir = path.join(this.dir, family);
    const v1 = path.join(famDir, 'v1');
    const moves = new Map<string, string>();
    const st = await fs.stat(famDir).catch(() => null);
    if (st?.isDirectory()) {
      // Files directly in the family folder: move all of them (engine + network files).
      await fs.mkdir(v1, { recursive: true });
      for (const ent of await fs.readdir(famDir, { withFileTypes: true })) {
        if (ent.isDirectory() || ent.name.startsWith('.')) continue;
        moves.set(path.join(famDir, ent.name), path.join(v1, ent.name));
      }
    } else {
      // Loose files in engines/: move the engine file(s); a file may be named like the folder.
      const tmp = path.join(this.dir, `.${family}.moving`);
      await fs.mkdir(tmp, { recursive: true });
      for (const e of legacy) {
        const file = engineFile(e);
        if (file) moves.set(file, path.join(tmp, path.basename(file)));
      }
      for (const [from, to] of moves) await fs.rename(from, to);
      await fs.mkdir(famDir, { recursive: true });
      await fs.rename(tmp, v1);
      for (const [from, to] of moves) moves.set(from, path.join(v1, path.basename(to)));
    }
    if (st?.isDirectory()) for (const [from, to] of moves) await fs.rename(from, to);
    const config = await this.readConfig();
    const moved = (p: string) => moves.get(this.resolve(p));
    let changed = false;
    for (const c of config) {
      const cmd = moved(c.command);
      if (cmd) [c.command, changed] = [this.relCommand(cmd), true];
      c.args = c.args?.map((a) => (path.isAbsolute(a) && moved(a) ? ((changed = true), moved(a)!) : a));
    }
    if (changed) await this.writeConfig(config);
  }

  /** Set the display name; engines found by scanning get an `engines.json` entry for it. */
  async rename(id: string, name: string) {
    const e = this.get(id);
    if (!e) return this.engines;
    const config = await this.readConfig();
    const entry = config.find((c) => this.idOf(c) === id);
    if (entry) entry.name = name;
    else config.push({ name, command: this.relCommand(e.command), args: e.args });
    await this.writeConfig(config);
    return this.refresh();
  }

  async remove(id: string) {
    const e = this.get(id);
    if (!e) return this.engines;
    const config = await this.readConfig();
    if (config.some((c) => this.idOf(c) === id)) await this.writeConfig(config.filter((c) => this.idOf(c) !== id));
    const file = engineFile(e);
    if (file && path.resolve(file).startsWith(this.dir + path.sep)) {
      if (e.family && e.version) {
        // A version is its whole folder; drop the engine's folder once no versions are left.
        const famDir = path.join(this.dir, e.family);
        await fs.rm(path.join(famDir, e.version), { recursive: true, force: true });
        if (!(await fs.readdir(famDir).catch(() => [])).some((n) => !n.startsWith('.'))) await fs.rm(famDir, { recursive: true, force: true });
      } else {
        // Delete the engine file (for scripts, the script).
        await fs.rm(file, { force: true });
      }
    }
    return this.refresh();
  }

  /** Family and version from where the engine file sits in the engines folder. */
  private withVersion(e: EngineInfo, configName?: string): EngineInfo {
    const file = engineFile(e);
    const rel = file ? path.relative(this.dir, file) : '..';
    if (rel.startsWith('..') || path.isAbsolute(rel)) return e;
    const parts = rel.split(path.sep);
    if (parts.length === 1) e.family = stem(parts[0]);
    else e.family = parts[0];
    if (parts.length === 3) {
      e.version = parts[1];
      e.label = configName ?? parts[1];
      e.name = `${e.family} ${e.label}`;
    }
    return e;
  }

  private idOf(c: ConfigEntry) {
    return idFor(this.resolve(c.command), c.args ?? []);
  }

  /** Engine-folder paths as `./x` or `x/y`, so `engines.json` works in Docker and natively. */
  private relCommand(command: string) {
    const rel = path.relative(this.dir, command);
    if (!path.isAbsolute(command) || rel.startsWith('..')) return command;
    return rel.includes(path.sep) ? rel : `./${rel}`;
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
          // engines/<engine>/ and engines/<engine>/<version>/
          if (depth < 2) await visit(full, depth + 1);
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
    const def = { ...this.def(e), options: {} };
    const files = `${await mtime(e.command)}\0${e.args[0] ? await mtime(e.args[0]) : ''}`;
    const key = [e.command, ...e.args, files, def.host, engineHost.connected && engineHost.platform].join('\0');
    let res = this.probeCache.get(key);
    if (!res) {
      const eng = new UciEngine(def);
      try {
        await eng.start(5000);
        const host = eng.onHost ? (PLATFORMS[engineHost.platform] ?? engineHost.platform) : undefined;
        res = { status: 'ok', author: eng.author || undefined, uciName: eng.name || undefined, host };
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
    e.host = res.host;
    // Versions keep "<family> <version>": all versions usually report the same UCI name.
    if (e.source === 'auto' && res.uciName && !e.version) e.name = res.uciName;
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

function stem(file: string) {
  return path.basename(file).replace(/\.(py|js|mjs|sh)$/, '');
}

/** The engine's own file: the executable, or the script for interpreters. */
function engineFile(e: { command: string; args: string[] }) {
  if (path.isAbsolute(e.command)) return e.command;
  return e.args[0] && path.isAbsolute(e.args[0]) ? e.args[0] : undefined;
}

/** The number in a version name ('v12' → 12), for sorting; 0 when there is none. */
export function versionNum(v?: string) {
  return Number(v?.match(/\d+/)?.[0] ?? 0);
}

function idFor(command: string, args: string[]) {
  return createHash('sha1').update([command, ...args].join('\0')).digest('hex').slice(0, 10);
}

async function mtime(p: string) {
  const st = await fs.stat(p).catch(() => null);
  return st ? st.mtimeMs : 0;
}
