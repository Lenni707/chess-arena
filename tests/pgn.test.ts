import { describe, expect, it } from 'vitest';
import { toPgn } from '../client/src/pgn.js';
import { START_FEN, type GameState } from '../shared/protocol.js';

const game = (over: Partial<GameState> = {}): GameState => ({
  id: 'm-0',
  white: { name: 'Bot "v2"', ref: 'a' },
  black: { name: 'Bot v1', ref: 'b' },
  startFen: START_FEN,
  moves: [
    { uci: 'f2f3', san: 'f3', eval: { cp: -40 } },
    { uci: 'e7e5', san: 'e5' },
    { uci: 'g2g4', san: 'g4', eval: { cp: -350 } },
    { uci: 'd8h4', san: 'Qh4#', eval: { mate: -1 } },
  ],
  fen: '',
  clock: { w: 0, b: 0, running: null, tc: { kind: 'clock', baseMs: 60_000, incMs: 500 } },
  result: '0-1',
  reason: 'checkmate',
  startedAt: new Date(2026, 9, 22).getTime(),
  event: 'Bot v2 vs Bot v1',
  round: 3,
  ...over,
});

describe('PGN export', () => {
  it('writes the standard tags and SAN movetext with evals', () => {
    expect(toPgn(game())).toBe(
      [
        '[Event "Bot v2 vs Bot v1"]',
        '[Site "Chess Arena"]',
        '[Date "2026.10.22"]',
        '[Round "3"]',
        '[White "Bot \\"v2\\""]',
        '[Black "Bot v1"]',
        '[Result "0-1"]',
        '[TimeControl "60+0.5"]',
        '[Termination "normal"]',
        '',
        // Lines wrap at 80 characters, between tokens.
        '1. f3 { [%eval -0.40] } 1... e5 2. g4 { [%eval -3.50] } 2... Qh4#',
        '{ [%eval #-1] } { checkmate } 0-1',
        '',
      ].join('\n'),
    );
  });

  it('marks unfinished games and losses on time', () => {
    expect(toPgn(game({ result: '*', reason: undefined }))).toMatch(/\[Termination "unterminated"\][\s\S]*Qh4#\s\{ \[%eval #-1\] \} \*\n$/);
    expect(toPgn(game({ result: '1-0', reason: 'Bot v1 ran out of time' }))).toContain('[Termination "time forfeit"]');
    expect(toPgn(game({ clock: { w: 0, b: 0, running: null, tc: { kind: 'depth', depth: 16 } } }))).toContain('[TimeControl "-"]');
  });
});
