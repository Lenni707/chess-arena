import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { UciEngine } from '../server/uci.js';
import { EnginePlayer, Game, type Player } from '../server/game.js';

/** Plays the given moves in order (and only those). */
function scripted(name: string, moves: string[]): Player {
  return { name, ref: name, move: async () => ({ uci: moves.shift() ?? '0000' }), cancel() {} };
}

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

describe('Game rules (shakmaty)', () => {
  const tc = { kind: 'movetime', ms: 100 } as const;

  it('ends on checkmate with SAN', async () => {
    const g = new Game('t', scripted('W', ['f2f3', 'g2g4']), scripted('B', ['e7e5', 'd8h4']), tc);
    expect(await g.run()).toBe('0-1');
    expect(g.reason).toBe('checkmate');
    expect(g.moves.map((m) => m.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
  });

  it('draws on threefold repetition', async () => {
    const g = new Game('t', scripted('W', ['g1f3', 'f3g1', 'g1f3', 'f3g1']), scripted('B', ['g8f6', 'f6g8', 'g8f6', 'f6g8']), tc);
    expect(await g.run()).toBe('1/2-1/2');
    expect(g.reason).toBe('threefold repetition');
  });

  it('an illegal move loses', async () => {
    const g = new Game('t', scripted('W', ['e2e5']), scripted('B', []), tc);
    expect(await g.run()).toBe('0-1');
    expect(g.reason).toMatch(/illegal move \(e2e5\)/);
  });
});

describe('engine strength', () => {
  it('reads the UCI_Elo range only when UCI_LimitStrength exists too', async () => {
    const e = new UciEngine({ ...RANDOM, args: [...RANDOM.args] });
    process.env.RANDOM_ENGINE_ELO = '1320-3190';
    await e.start();
    delete process.env.RANDOM_ENGINE_ELO;
    expect(e.eloRange).toEqual({ min: 1320, max: 3190 });
    e.quit();
    const plain = new UciEngine(RANDOM);
    await plain.start();
    expect(plain.eloRange).toBeNull();
    plain.quit();
  });
});
