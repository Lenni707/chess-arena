import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { UciEngine } from '../server/uci.js';
import { EnginePlayer, Game } from '../server/game.js';

const RANDOM = { command: 'node', args: [path.resolve('tests/fixtures/random-engine.mjs')], options: {} };

describe('UciEngine', () => {
  it('handshakes and returns a legal move', async () => {
    const e = new UciEngine(RANDOM);
    await e.start();
    expect(e.name).toBe('RandomMover');
    const r = await e.go('startpos', ['e2e4'], { movetime: 10 }, 2000);
    expect(r.move).toMatch(/^[a-h][1-8][a-h][1-8]/);
    e.quit();
  });

  it('reports a missing binary', async () => {
    const e = new UciEngine({ command: '/nope/engine', args: [], options: {} });
    await expect(e.start(1000)).rejects.toThrow(/not found/);
  });
});

describe('Game', () => {
  it('plays to a finished result', async () => {
    const a = new UciEngine(RANDOM);
    const b = new UciEngine(RANDOM);
    await Promise.all([a.start(), b.start()]);
    const g = new Game('t', new EnginePlayer(a, 'A', 'a'), new EnginePlayer(b, 'B', 'b'), { kind: 'clock', baseMs: 60_000, incMs: 0 });
    const result = await g.run();
    expect(['1-0', '0-1', '1/2-1/2']).toContain(result);
    expect(g.reason).toBeTruthy();
    a.quit();
    b.quit();
  }, 30_000);

  it('flags an engine that exceeds its clock', async () => {
    const slow = { ...RANDOM };
    process.env.RANDOM_ENGINE_DELAY = '400';
    const a = new UciEngine(slow);
    const b = new UciEngine(RANDOM);
    await Promise.all([a.start(), b.start()]);
    delete process.env.RANDOM_ENGINE_DELAY;
    const g = new Game('t', new EnginePlayer(a, 'Slow', 'a'), new EnginePlayer(b, 'B', 'b'), { kind: 'clock', baseMs: 200, incMs: 0 });
    await g.run();
    expect(g.result).toBe('0-1');
    expect(g.reason).toMatch(/time/);
    a.quit();
    b.quit();
  }, 10_000);
});
