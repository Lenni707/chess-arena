import type { GameState, MoveRecord } from '../../shared/protocol';
import { START_FEN } from '../../shared/protocol';

/**
 * A game as PGN, the standard format chess software imports. Engine evaluations
 * become `[%eval …]` comments (White's point of view, in pawns), which Lichess and
 * most analysis tools read; moves from a human have none.
 */
export function toPgn(g: GameState): string {
  const date = new Date(g.startedAt);
  const tags: [string, string][] = [
    ['Event', g.event ?? 'Chess Arena game'],
    ['Site', 'Chess Arena'],
    ['Date', `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`],
    ['Round', g.round ? String(g.round) : '-'],
    ['White', g.white.name],
    ['Black', g.black.name],
    ['Result', g.result],
    ['TimeControl', timeControl(g)],
    ['Termination', termination(g)],
  ];
  if (g.startFen !== START_FEN) tags.push(['SetUp', '1'], ['FEN', g.startFen]);
  const header = tags.map(([k, v]) => `[${k} "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n');

  const tokens: string[] = [];
  const blackFirst = g.startFen.split(' ')[1] === 'b';
  const firstMove = Number(g.startFen.split(' ')[5]) || 1;
  let needNumber = true;
  g.moves.forEach((m, i) => {
    const ply = i + (blackFirst ? 1 : 0);
    const num = firstMove + Math.floor(ply / 2);
    const white = ply % 2 === 0;
    if (white) tokens.push(`${num}.`);
    else if (needNumber) tokens.push(`${num}...`);
    tokens.push(m.san);
    const comment = evalComment(m);
    if (comment) tokens.push(comment);
    // After a comment, Black's next move needs its number again ("12... Nf6").
    needNumber = !!comment;
  });
  if (g.result !== '*' && g.reason) tokens.push(`{ ${g.reason.replace(/[{}]/g, '')} }`);
  tokens.push(g.result);
  return `${header}\n\n${wrap(tokens)}\n`;
}

/** Save the game as a .pgn file. */
export function downloadPgn(g: GameState) {
  const name = `${g.white.name} vs ${g.black.name}${g.round ? ` game ${g.round}` : ''}`.replace(/[^\w.+() -]/g, '_');
  const url = URL.createObjectURL(new Blob([toPgn(g)], { type: 'application/x-chess-pgn' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.pgn`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function evalComment(m: MoveRecord) {
  const e = m.eval;
  if (!e) return '';
  if (e.mate !== undefined) return `{ [%eval #${e.mate}] }`;
  if (e.cp !== undefined) return `{ [%eval ${(e.cp / 100).toFixed(2)}] }`;
  return '';
}

function timeControl(g: GameState) {
  const tc = g.clock.tc;
  if (tc.kind === 'clock') return `${tc.baseMs / 1000}+${tc.incMs / 1000}`;
  // PGN has no notation for "N seconds per move" or "to depth N"; '-' is "no time control".
  return '-';
}

/** PGN's standard Termination values. */
function termination(g: GameState) {
  if (g.result === '*') return 'unterminated';
  const r = g.reason ?? '';
  if (/ran out of time/.test(r)) return 'time forfeit';
  if (/illegal move/.test(r)) return 'rules infraction';
  if (/crashed|failed/.test(r)) return 'abandoned';
  return 'normal';
}

/** Join tokens into lines of at most 80 characters, as the PGN standard asks. */
function wrap(tokens: string[]) {
  const lines: string[] = [];
  let line = '';
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > 80) {
      lines.push(line);
      line = t;
    } else line = line ? `${line} ${t}` : t;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
