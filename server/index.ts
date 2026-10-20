import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMsg, PlayerRef, ServerMsg, TimeControl } from '../shared/protocol.js';
import { EngineRegistry } from './engines.js';
import { EnginePlayer, Game, HumanPlayer, type Player } from './game.js';
import { Match } from './match.js';
import { UciEngine } from './uci.js';

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = process.cwd();
const ENGINES_DIR = path.resolve(process.env.ENGINES_DIR ?? path.join(ROOT, 'engines'));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? path.join(ROOT, 'dist/client'));

const registry = new EngineRegistry(ENGINES_DIR);
const watching = new Map<WebSocket, string | null>();

let play: { game: Game; engines: UciEngine[]; human: HumanPlayer[] } | null = null;
let match: Match | null = null;

// ---------- static files ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = path.join(STATIC_DIR, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) return void res.writeHead(403).end();
  const st = await fs.stat(file).catch(() => null);
  if (!st?.isFile()) file = path.join(STATIC_DIR, 'index.html');
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Client not built. Run `npm run build` or use `npm run dev`.');
  }
});

// ---------- websocket ----------

const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

wss.on('connection', (ws) => {
  watching.set(ws, null);
  send(ws, { t: 'hello', cores: os.cpus().length });
  send(ws, { t: 'engines', engines: registry.list() });
  send(ws, { t: 'match', match: match?.summary() ?? null });
  if (play) send(ws, { t: 'game', game: play.game.state() });
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(ws, msg).catch((err) => send(ws, { t: 'error', message: (err as Error).message }));
  });
  ws.on('close', () => watching.delete(ws));
});

async function handle(ws: WebSocket, msg: ClientMsg) {
  switch (msg.t) {
    case 'engines.refresh':
      broadcast({ t: 'engines', engines: await registry.refresh() });
      break;
    case 'engines.add':
      if (!msg.command.trim()) throw new Error('Engine command is empty');
      broadcast({ t: 'engines', engines: await registry.add(msg.name.trim(), msg.command.trim(), msg.args ?? []) });
      break;
    case 'engines.remove':
      broadcast({ t: 'engines', engines: await registry.remove(msg.id) });
      break;
    case 'play.new':
      await startPlay(msg.white, msg.black, msg.tc);
      break;
    case 'play.move': {
      if (!play || play.game.id !== msg.gameId || play.game.over) return;
      const turn = play.game.chess.turn();
      const p = turn === 'w' ? play.game.white : play.game.black;
      const legal = play.game.chess.moves({ verbose: true }).some((m) => m.lan === msg.uci);
      if (p instanceof HumanPlayer && p.waiting && legal) p.submit(msg.uci);
      else send(ws, { t: 'game', game: play.game.state() });
      break;
    }
    case 'play.resign': {
      if (!play || play.game.id !== msg.gameId) return;
      const g = play.game;
      if (g.over) return;
      const humanWhite = g.white instanceof HumanPlayer;
      const humanBlack = g.black instanceof HumanPlayer;
      // With two humans the side to move resigns; with no humans this just aborts.
      if (!humanWhite && !humanBlack) g.end('*', 'stopped');
      else {
        const loser = humanWhite && humanBlack ? g.chess.turn() : humanWhite ? 'w' : 'b';
        g.end(loser === 'w' ? '0-1' : '1-0', `${loser === 'w' ? 'White' : 'Black'} resigned`);
      }
      break;
    }
    case 'match.start':
      startMatch(msg);
      break;
    case 'match.stop':
      match?.stop();
      break;
    case 'watch': {
      watching.set(ws, msg.gameId);
      const g = msg.gameId ? findGame(msg.gameId) : null;
      if (g) send(ws, { t: 'game', game: g.state() });
      break;
    }
  }
}

function findGame(id: string): Game | null {
  if (play?.game.id === id) return play.game;
  if (match && id.startsWith(match.id + '-')) return match.games[Number(id.slice(match.id.length + 1))] ?? null;
  return null;
}

// ---------- play ----------

function stopPlay() {
  if (!play) return;
  play.game.stop();
  for (const e of play.engines) e.quit();
  play = null;
}

async function startPlay(white: PlayerRef, black: PlayerRef, tc: TimeControl) {
  stopPlay();
  const engines: UciEngine[] = [];
  const humans: HumanPlayer[] = [];
  const makePlayer = async (ref: PlayerRef): Promise<Player> => {
    if (ref === 'human') {
      const h = new HumanPlayer();
      humans.push(h);
      return h;
    }
    const info = registry.get(ref);
    if (!info) throw new Error('Unknown engine');
    const eng = new UciEngine(registry.def(info));
    engines.push(eng);
    try {
      await eng.start();
      await eng.newGame();
    } catch (err) {
      for (const e of engines) e.quit();
      throw new Error(`${info.name} failed to start: ${(err as Error).message}`);
    }
    return new EnginePlayer(eng, info.name, info.id);
  };
  const w = await makePlayer(white);
  const b = await makePlayer(black);
  const game = new Game(`play-${Date.now().toString(36)}`, w, b, tc, (g) => {
    if (play?.game === g) broadcast({ t: 'game', game: g.state() });
  });
  play = { game, engines, human: humans };
  game.run().finally(() => {
    for (const e of engines) e.quit();
  });
}

// ---------- match ----------

function startMatch(msg: Extract<ClientMsg, { t: 'match.start' }>) {
  const a = registry.get(msg.engineA);
  const b = registry.get(msg.engineB);
  if (!a || !b) throw new Error('Pick two engines');
  match?.stop();
  const games = clamp(Math.round(msg.games), 1, 2000);
  const concurrency = clamp(Math.round(msg.concurrency), 1, 256);
  const m = new Match(
    { engineA: a, engineB: b, defA: registry.def(a), defB: registry.def(b), games, tc: msg.tc, concurrency },
    (t) => {
      if (match === m) broadcast({ t: 'match.tick', id: m.id, ...t });
    },
    (g) => {
      const data = JSON.stringify({ t: 'game', game: g.state() } satisfies ServerMsg);
      for (const [ws, id] of watching) if (id === g.id && ws.readyState === WebSocket.OPEN) ws.send(data);
    },
  );
  match = m;
  broadcast({ t: 'match', match: m.summary() });
  m.run().catch((err) => console.error('match failed', err));
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

// ---------- boot ----------

await registry.refresh();
server.listen(PORT, () => {
  console.log(`chess-arena on http://localhost:${PORT}`);
  console.log(`engines dir: ${ENGINES_DIR} (${registry.list().length} found)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopPlay();
    match?.stop();
    process.exit(0);
  });
}
