#!/usr/bin/env node
// Test-only UCI engine: plays a random legal move. Never shipped in engines/.
import { createInterface } from 'node:readline';
import { Chess } from 'chess.js';

const delay = Number(process.env.RANDOM_ENGINE_DELAY ?? 0);
let chess = new Chess();
const out = (s) => process.stdout.write(s + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (cmd === 'uci') {
    out('id name RandomMover');
    out('id author tests');
    out('uciok');
  } else if (cmd === 'isready') out('readyok');
  else if (cmd === 'position') {
    chess = new Chess();
    const mi = rest.indexOf('moves');
    if (rest[0] === 'fen') chess.load(rest.slice(1, mi < 0 ? undefined : mi).join(' '));
    if (mi >= 0) for (const m of rest.slice(mi + 1)) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  } else if (cmd === 'go') {
    const moves = chess.moves({ verbose: true });
    const m = moves[Math.floor(Math.random() * moves.length)];
    setTimeout(() => {
      out(`info depth 1 score cp ${Math.round(Math.random() * 100 - 50)}`);
      out(`bestmove ${m ? m.lan : '0000'}`);
    }, delay);
  } else if (cmd === 'quit') process.exit(0);
});
