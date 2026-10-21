import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Match } from '../server/match.js';
import { EngineRegistry } from '../server/engines.js';
import type { EngineInfo } from '../shared/protocol.js';

const RANDOM = { command: 'node', args: [path.resolve('tests/fixtures/random-engine.mjs')], options: {} };
const info = (id: string): EngineInfo => ({ id, name: id, ...RANDOM, source: 'config', status: 'ok' });

describe('Match', () => {
  it('plays all games in parallel slots and tallies them', async () => {
    const ticks: number[] = [];
    const m = new Match(
      { engineA: info('A'), engineB: info('B'), defA: RANDOM, defB: RANDOM, games: 6, tc: { kind: 'movetime', ms: 1 }, concurrency: 3 },
      (t) => ticks.push(t.tally.done),
    );
    expect(m.boards).toHaveLength(3);
    await m.run();
    const t = m.tally;
    expect(t.done).toBe(6);
    expect(t.aWins + t.bWins + t.draws).toBe(6);
    expect(m.running).toBe(false);
    expect(ticks.at(-1)).toBe(6);
  }, 60_000);
});

// Minimal UCI engine that only handshakes; enough for the registry's probe.
const STUB = `process.stdin.on('data', (d) => {
  for (const l of String(d).split('\\n')) {
    if (l === 'uci') console.log('id name Stub\\nuciok');
    if (l === 'isready') console.log('readyok');
    if (l === 'quit') process.exit(0);
  }
});`;

describe('engine versions', () => {
  it('moves a single-file engine into v1 when v2 is added', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-'));
    await fs.writeFile(path.join(dir, 'bot.mjs'), STUB);
    const reg = new EngineRegistry(dir);
    let list = await reg.refresh();
    expect(list.map((e) => [e.family, e.version])).toEqual([['bot', undefined]]);

    await reg.rename(list[0].id, 'Old Bot');
    await reg.saveUpload('bot', 'v2', 'bot.mjs', Readable.from([STUB]));
    list = await reg.refresh();
    expect(list.map((e) => [e.name, e.version, e.status])).toEqual([
      ['bot v2', 'v2', 'ok'],
      ['bot Old Bot', 'v1', 'ok'],
    ]);
    expect(await fs.readdir(path.join(dir, 'bot'))).toEqual(['v1', 'v2']);

    await reg.remove(list[1].id);
    expect(await fs.readdir(path.join(dir, 'bot'))).toEqual(['v2']);
    await fs.rm(dir, { recursive: true });
  });
});
