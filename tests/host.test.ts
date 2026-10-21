import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { engineHost } from '../server/host-link.js';
import { UciEngine } from '../server/uci.js';

// Runs the real engine host on a spare port, serving tests/fixtures as its engines folder.
const DIR = path.resolve('tests/fixtures');
const PORT = 7199;
let host: ChildProcess;

beforeAll(async () => {
  host = spawn(process.execPath, ['host/engine-host.ts'], {
    env: { ...process.env, ENGINES_DIR: DIR, ENGINE_HOST_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) => host.stdout!.on('data', (d) => /engine host on/.test(String(d)) && resolve()));
  const up = new Promise<void>((resolve) => (engineHost.onChange = () => engineHost.connected && resolve()));
  engineHost.start(`127.0.0.1:${PORT}`, DIR);
  await up;
});

afterAll(() => {
  engineHost.stop();
  host.kill();
});

describe('engine host', () => {
  it('runs an engine on the host and relays UCI', async () => {
    const e = new UciEngine({ command: 'node', args: [path.join(DIR, 'random-engine.mjs')], options: {}, host: true });
    await e.start();
    expect(e.onHost).toBe(true);
    expect(e.name).toBe('RandomMover');
    const r = await e.go('startpos', ['e2e4'], { movetime: 10 }, 2000);
    expect(r.move).toMatch(/^[a-h][1-8][a-h][1-8]/);
    e.quit();
  });

  it('refuses programs outside the engines folder', async () => {
    const e = new UciEngine({ command: '/bin/sh', args: [], options: {}, host: true });
    await expect(e.start(2000)).rejects.toThrow(/refused/);
  });
});
