#!/usr/bin/env node
// Test-only UCI engine: plays a random legal move. Never shipped in engines/.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { initSync, Position } from '../../core/pkg/arena_core.js';

initSync({ module: readFileSync(new URL('../../core/pkg/arena_core_bg.wasm', import.meta.url)) });

const delay = Number(process.env.RANDOM_ENGINE_DELAY ?? 0);
let pos = new Position();
const out = (s) => process.stdout.write(s + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (cmd === 'uci') {
    out('id name RandomMover');
    out('id author tests');
    // RANDOM_ENGINE_ELO=min-max advertises the options for playing at a set Elo.
    const elo = process.env.RANDOM_ENGINE_ELO?.split('-');
    if (elo) {
      out('option name UCI_LimitStrength type check default false');
      out(`option name UCI_Elo type spin default ${elo[0]} min ${elo[0]} max ${elo[1]}`);
    }
    out('uciok');
  } else if (cmd === 'isready') out('readyok');
  else if (cmd === 'position') {
    const mi = rest.indexOf('moves');
    pos = new Position(rest[0] === 'fen' ? rest.slice(1, mi < 0 ? undefined : mi).join(' ') : undefined);
    if (mi >= 0) for (const m of rest.slice(mi + 1)) pos.play(m);
  } else if (cmd === 'go') {
    const moves = pos.legalMoves();
    const m = moves[Math.floor(Math.random() * moves.length)];
    setTimeout(() => {
      out(`info depth 1 score cp ${Math.round(Math.random() * 100 - 50)}`);
      out(`bestmove ${m ?? '0000'}`);
    }, delay);
  } else if (cmd === 'quit') process.exit(0);
});
