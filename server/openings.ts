import { Chess } from 'chess.js';

// Short, roughly balanced opening lines. Each match game starts from one of these
// so deterministic engines don't replay the same game every time.
const LINES = `
e4 e5 Nf3 Nc6 Bb5 a6
e4 e5 Nf3 Nc6 Bc4 Bc5
e4 e5 Nf3 Nc6 Bc4 Nf6
e4 e5 Nf3 Nc6 d4 exd4
e4 e5 Nf3 Nf6 Nxe5 d6
e4 e5 Nc3 Nf6 f4 d5
e4 e5 f4 exf4 Nf3 g5
e4 c5 Nf3 d6 d4 cxd4
e4 c5 Nf3 Nc6 d4 cxd4
e4 c5 Nf3 e6 d4 cxd4
e4 c5 Nc3 Nc6 g3 g6
e4 c5 c3 Nf6 e5 Nd5
e4 e6 d4 d5 Nc3 Bb4
e4 e6 d4 d5 Nd2 c5
e4 e6 d4 d5 e5 c5
e4 c6 d4 d5 e5 Bf5
e4 c6 d4 d5 Nc3 dxe4
e4 d6 d4 Nf6 Nc3 g6
e4 g6 d4 Bg7 Nc3 d6
e4 d5 exd5 Qxd5 Nc3 Qa5
e4 Nf6 e5 Nd5 d4 d6
d4 d5 c4 e6 Nc3 Nf6
d4 d5 c4 c6 Nf3 Nf6
d4 d5 c4 dxc4 Nf3 Nf6
d4 d5 Nf3 Nf6 Bf4 e6
d4 d5 Bf4 Nf6 e3 c5
d4 Nf6 c4 e6 Nc3 Bb4
d4 Nf6 c4 e6 Nf3 b6
d4 Nf6 c4 g6 Nc3 Bg7
d4 Nf6 c4 g6 Nc3 d5
d4 Nf6 c4 c5 d5 b5
d4 Nf6 c4 c5 d5 e6
d4 Nf6 c4 e6 g3 d5
d4 Nf6 Nf3 g6 Bg5 Bg7
d4 f5 g3 Nf6 Bg2 g6
c4 e5 Nc3 Nf6 Nf3 Nc6
c4 c5 Nc3 Nc6 g3 g6
c4 Nf6 Nc3 e6 e4 d5
c4 e6 Nf3 d5 g3 Nf6
Nf3 d5 g3 Nf6 Bg2 c6
Nf3 Nf6 c4 b6 g3 Bb7
Nf3 c5 c4 Nc6 Nc3 g6
g3 d5 Bg2 Nf6 Nf3 c6
b3 e5 Bb2 Nc6 e3 Nf6
f4 d5 Nf3 Nf6 e3 g6
e4 e5 Nf3 Nc6 Nc3 Nf6
e4 e5 Bc4 Nf6 d3 c6
e4 c5 Nf3 d6 Bb5+ Bd7
e4 c6 Nc3 d5 Nf3 Bg4
d4 e6 c4 Bb4+ Bd2 Qe7
`;

export const OPENINGS: string[][] = LINES.trim()
  .split('\n')
  .map((line) => {
    const c = new Chess();
    for (const san of line.trim().split(/\s+/)) c.move(san);
    return c.history({ verbose: true }).map((m) => m.lan);
  });

/**
 * Opening for game `i`: games come in pairs that share an opening with colors
 * swapped. After the book runs out, lines get extra random plies so they stay unique.
 */
export function openingFor(i: number, seed: number): string[] {
  const pair = Math.floor(i / 2);
  const order = shuffled(OPENINGS.length, seed);
  const base = OPENINGS[order[pair % OPENINGS.length]];
  const round = Math.floor(pair / OPENINGS.length);
  if (round === 0) return base;
  const rnd = mulberry(seed * 7919 + pair);
  const c = new Chess();
  for (const m of base) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  for (let k = 0; k < 2; k++) {
    const them = c.turn() === 'w' ? 'b' : 'w';
    const legal = c.moves({ verbose: true }).filter((m) => !m.captured && !c.isAttacked(m.to, them));
    if (!legal.length) break;
    c.move(legal[Math.floor(rnd() * legal.length)]);
  }
  return c.history({ verbose: true }).map((m) => m.lan);
}

function shuffled(n: number, seed: number) {
  const a = Array.from({ length: n }, (_, i) => i);
  const rnd = mulberry(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
