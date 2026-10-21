import type { MatchBoard, Result, Tally, TimeControl } from '../../../shared/protocol';
import { h } from '../dom';
import { parseFen, pieceImages, piecesReady, sqIndex } from '../pieces';
import { on, store } from '../store';
import { conn } from '../ws';
import { chips, enginesSection, engineSelect } from './engines';

const GAMES = [100, 1000, 5000, 10000].map((n) => ({ label: n.toLocaleString('en'), value: n }));
const TIME: { label: string; value: TimeControl }[] = [
  { label: '20 ms', value: { kind: 'movetime', ms: 20 } },
  { label: '100 ms', value: { kind: 'movetime', ms: 100 } },
  { label: '1 s', value: { kind: 'movetime', ms: 1000 } },
  { label: '10 + 0.1', value: { kind: 'clock', baseMs: 10_000, incMs: 100 } },
];
const BOARDS = [16, 64, 100, 200].map((n) => ({ label: String(n), value: n }));

const LIGHT = '#dcd8cc';
const DARK = '#7d8ba0';
const LAST = 'rgba(240, 180, 76, 0.45)';

/** Engine vs. engine: N games, many at once, each live on a small board. */
export function matchView(): { el: HTMLElement } {
  const engineA = engineSelect('Engine A');
  const engineB = engineSelect('Engine B');
  const games = chips(GAMES, 1);
  const time = chips(TIME, 0);
  const boards = chips(BOARDS, 2);
  const error = h('p.form-error', { role: 'alert' });

  // Default pairing: the newest version of an engine against the one before it.
  let paired = false;
  const pairVersions = () => {
    if (paired) return;
    const ok = store.engines.filter((e) => e.status === 'ok');
    const fam = ok.find((e) => e.version && ok.some((o) => o.family === e.family && o.id !== e.id));
    if (fam) {
      const versions = ok.filter((e) => e.family === fam.family);
      engineA.value = versions[0].id;
      engineB.value = versions[1].id;
      paired = true;
    } else if (ok.length > 1 && engineB.value === engineA.value) {
      engineB.value = ok[1].id;
    }
  };
  on('engines', pairVersions);
  pairVersions();

  const start = h('button.btn.primary', {
    type: 'button',
    onclick: () => {
      if (store.match?.running) return conn.send({ t: 'match.stop' });
      if (!engineA.value || !engineB.value) {
        error.textContent = 'Add two engines (or two versions of one) first.';
        return;
      }
      error.textContent = '';
      conn.send({ t: 'match.start', engineA: engineA.value, engineB: engineB.value, games: games.get(), tc: time.get(), concurrency: boards.get() });
    },
  }, 'Start match');

  const score = scoreCard();
  const panel = h(
    'aside.panel',
    {},
    h('section.setup', {},
      h('label.field', {}, h('span.a-label', {}, 'Engine A'), engineA),
      h('label.field', {}, h('span.b-label', {}, 'Engine B'), engineB),
      h('div.field', {}, h('span', {}, 'Games'), games.el),
      h('div.field', {}, h('span', {}, 'Time per move'), time.el),
      h('div.field', {}, h('span', {}, 'Boards at once'), boards.el),
      h('div.actions', {}, start),
      error,
    ),
    score.el,
    enginesSection(),
  );

  const grid = new BoardGrid();
  const el = h('div.play.match-view', {}, h('div.stage.grid-stage', {}, grid.el), panel);

  const sync = () => {
    const m = store.match;
    start.textContent = m?.running ? 'Stop' : 'Start match';
    start.classList.toggle('stop', !!m?.running);
    score.update();
    grid.setBoards(m?.boards ?? []);
  };
  on('match', sync);
  on('match.tick', (changed: MatchBoard[]) => {
    start.textContent = store.match?.running ? 'Stop' : 'Start match';
    start.classList.toggle('stop', !!store.match?.running);
    score.update();
    grid.update(changed);
  });
  on('error', (msg: string) => (error.textContent = msg));
  sync();
  return { el };
}

/** Wins of A, draws, wins of B, a bar of the three, and the Elo difference. */
function scoreCard() {
  const nameA = h('span.sc-name.a');
  const nameB = h('span.sc-name.b');
  const aWins = h('span.sc-num.a');
  const draws = h('span.sc-num.d');
  const bWins = h('span.sc-num.b');
  const barA = h('i.a');
  const barD = h('i.d');
  const barB = h('i.b');
  const stats = h('p.sc-stats');
  const el = h(
    'section.score',
    { hidden: true },
    h('div.sc-names', {}, nameA, h('span.sc-vs', {}, 'vs'), nameB),
    h('div.sc-nums', {}, aWins, draws, bWins),
    h('div.sc-labels', {}, h('span', {}, 'A wins'), h('span', {}, 'draws'), h('span', {}, 'B wins')),
    h('div.sc-bar', {}, barA, barD, barB),
    stats,
  );
  const update = () => {
    const m = store.match;
    el.hidden = !m;
    if (!m) return;
    const t = m.tally;
    nameA.textContent = m.engineA.name;
    nameB.textContent = m.engineB.name;
    aWins.textContent = String(t.aWins);
    draws.textContent = String(t.draws);
    bWins.textContent = String(t.bWins);
    const pct = (n: number) => `${t.total ? (n / t.total) * 100 : 0}%`;
    barA.style.width = pct(t.aWins);
    barD.style.width = pct(t.draws);
    barB.style.width = pct(t.bWins);
    stats.textContent = statsLine(t, m.running);
  };
  return { el, update };
}

function statsLine(t: Tally, running: boolean) {
  const state = running ? '' : t.done < t.total ? ' · stopped' : ' · finished';
  const parts = [`${t.done.toLocaleString('en')} / ${t.total.toLocaleString('en')} games${state}`];
  if (t.done) {
    const s = (t.aWins + t.draws / 2) / t.done;
    parts.push(`A scores ${(s * 100).toFixed(1)}%`);
    const e = elo(t);
    if (e) parts.push(`Elo A − B: ${e.diff >= 0 ? '+' : ''}${e.diff.toFixed(0)} ± ${e.err.toFixed(0)}`);
  }
  return parts.join(' · ');
}

/** Elo difference of A over B with a 95% error margin, from the per-game score variance. */
function elo(t: Tally) {
  const n = t.done;
  const losses = n - t.aWins - t.draws;
  const s = (t.aWins + t.draws / 2) / n;
  if (n < 10 || s <= 0 || s >= 1) return null;
  const variance = (t.aWins * (1 - s) ** 2 + t.draws * (0.5 - s) ** 2 + losses * s ** 2) / n;
  const se = Math.sqrt(variance / n);
  const toElo = (x: number) => -400 * Math.log10(1 / Math.min(0.9999, Math.max(0.0001, x)) - 1);
  return { diff: toElo(s), err: (toElo(s + 1.96 * se) - toElo(s - 1.96 * se)) / 2 };
}

/** Grid of small canvas boards; each redraws only when its position changed. */
class BoardGrid {
  readonly el = h('div.board-grid');
  private cells: { el: HTMLElement; canvas: HTMLCanvasElement; flash: HTMLElement; board: MatchBoard | null; drawn: string }[] = [];
  private dirty = new Set<number>();
  private frame = 0;
  private size = 0;

  constructor() {
    new ResizeObserver(() => this.layout()).observe(this.el);
    piecesReady.then(() => this.cells.forEach((_, i) => this.mark(i)));
  }

  setBoards(boards: MatchBoard[]) {
    if (boards.length !== this.cells.length) {
      this.cells = boards.map(() => {
        const canvas = h('canvas');
        const flash = h('span.mb-flash');
        return { el: h('div.mini-board', {}, canvas, flash), canvas, flash, board: null, drawn: '' };
      });
      this.el.replaceChildren(...this.cells.map((c) => c.el));
      this.layout();
    }
    this.update(boards);
  }

  update(boards: MatchBoard[]) {
    for (const b of boards) {
      const cell = this.cells[b.slot];
      if (!cell) continue;
      const prev = cell.board;
      cell.board = b;
      // A new game started in this slot: flash how the previous one ended.
      if (prev && prev.game !== b.game && b.last !== '*') this.flash(cell, b.last, b.lastAWhite);
      cell.el.classList.toggle('done', b.result !== '*');
      cell.el.dataset.result = b.result === '*' ? '' : winner(b.result, b.aWhite);
      cell.el.title = b.game < 0 ? '' : `Game ${b.game + 1}: ${b.aWhite ? 'A' : 'B'} has White${b.result !== '*' ? ` · ${b.result}` : ''}`;
      this.mark(b.slot);
    }
  }

  private flash(cell: (typeof this.cells)[number], result: Result, aWhite: boolean) {
    cell.flash.textContent = result === '1/2-1/2' ? '½' : result === '1-0' ? '1–0' : '0–1';
    cell.flash.dataset.result = winner(result, aWhite);
    cell.flash.classList.remove('show');
    void cell.flash.offsetWidth;
    cell.flash.classList.add('show');
  }

  /** Fit all boards into the stage: pick the column count that gives the biggest boards. */
  private layout() {
    const n = this.cells.length;
    if (!n) return;
    const gap = n > 100 ? 4 : 8;
    const w = this.el.clientWidth;
    const avail = this.el.parentElement!.clientHeight - 40;
    let best = 0;
    let bestCols = 1;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const size = Math.min((w - gap * (cols - 1)) / cols, avail > 100 ? (avail - gap * (rows - 1)) / rows : Infinity);
      if (size > best) [best, bestCols] = [size, cols];
    }
    const size = Math.max(40, Math.floor(best));
    this.el.style.setProperty('--mb', `${size}px`);
    this.el.style.setProperty('--gap', `${gap}px`);
    this.el.style.gridTemplateColumns = `repeat(${size === 40 ? 'auto-fill' : bestCols}, var(--mb))`;
    if (size !== this.size) {
      this.size = size;
      this.cells.forEach((c, i) => ((c.drawn = ''), this.mark(i)));
    }
  }

  private mark(i: number) {
    this.dirty.add(i);
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw() {
    this.frame = 0;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const px = Math.round(this.size * dpr);
    for (const i of this.dirty) {
      const cell = this.cells[i];
      const b = cell.board;
      if (!cell || !b || !px) continue;
      const key = `${b.fen}|${b.lm}|${px}`;
      if (key === cell.drawn) continue;
      cell.drawn = key;
      const c = cell.canvas;
      if (c.width !== px) [c.width, c.height] = [px, px];
      const ctx = c.getContext('2d')!;
      const sq = px / 8;
      const lm = b.lm ? [sqIndex(b.lm.slice(0, 2)), sqIndex(b.lm.slice(2, 4))] : [];
      parseFen(b.fen).forEach((code, k) => {
        const x = (k % 8) * sq;
        const y = Math.floor(k / 8) * sq;
        ctx.fillStyle = (k % 8) % 2 === Math.floor(k / 8) % 2 ? LIGHT : DARK;
        ctx.fillRect(x, y, sq, sq);
        if (lm.includes(k)) {
          ctx.fillStyle = LAST;
          ctx.fillRect(x, y, sq, sq);
        }
        const img = code && pieceImages.get(code);
        if (img && img.complete) ctx.drawImage(img, x, y, sq, sq);
      });
    }
    this.dirty.clear();
  }
}

/** 'a', 'b' or 'd' (draw) for a result, given whether A had White. */
function winner(result: Result, aWhite: boolean) {
  if (result === '1/2-1/2') return 'd';
  return (result === '1-0') === aWhite ? 'a' : 'b';
}
