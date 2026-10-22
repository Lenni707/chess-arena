import type { GameState, MatchBoard, Result, Tally, TimeControl } from '../../../shared/protocol';
import { h } from '../dom';
import { GameView } from './GameView';
import { parseFen, pieceImages, piecesReady, sqIndex } from '../pieces';
import { on, store } from '../store';
import { conn } from '../ws';
import { chips, enginesSection, engineSelect, strengthSelect } from './engines';

const GAMES = [1, 100, 1000, 5000, 10000].map((n) => ({ label: n.toLocaleString('en'), value: n }));
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

function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/**
 * Engine vs. engine: N games, many at once, each live on a small board. The
 * boards can be hidden (just the score), and clicking one shows it large.
 */
export function matchView(): { el: HTMLElement; onKey: (e: KeyboardEvent) => void } {
  const engineA = engineSelect('Engine A');
  const engineB = engineSelect('Engine B');
  const strengthA = strengthSelect(engineA, 'Engine A strength');
  const strengthB = strengthSelect(engineB, 'Engine B strength');
  const games = chips(GAMES, 2, () => idleLabel());
  const time = chips(TIME, 0);
  const boards = chips(BOARDS, 2);
  const showBoards = chips(
    [
      { label: 'Show', value: true },
      { label: 'Hide', value: false },
    ],
    load('match.boards') === 'hide' ? 1 : 0,
    (v) => {
      save('match.boards', v ? 'show' : 'hide');
      render();
    },
  );
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
    // Setting .value doesn't fire 'change'; the strength pickers listen for it.
    engineA.dispatchEvent(new Event('change'));
    engineB.dispatchEvent(new Event('change'));
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
      conn.send({ t: 'match.start', engineA: engineA.value, engineB: engineB.value, eloA: strengthA.value(), eloB: strengthB.value(), games: games.get(), tc: time.get(), concurrency: boards.get() });
    },
  }, 'Start match');

  const score = scoreCard();
  const poolNote = h('p.pool-note');
  const panel = h(
    'aside.panel',
    {},
    h('section.setup', {},
      h('div.field', {}, h('span.a-label', {}, 'Engine A'), h('div.engine-pick', {}, engineA, strengthA.el)),
      h('div.field', {}, h('span.b-label', {}, 'Engine B'), h('div.engine-pick', {}, engineB, strengthB.el)),
      h('div.field', {}, h('span', {}, 'Games'), games.el),
      h('div.field', {}, h('span', {}, 'Time per move'), time.el),
      h('div.field', {}, h('span', {}, 'Boards at once'), boards.el),
      h('div.field', {}, h('span', {}, 'Live boards'), showBoards.el),
      h('div.actions', {}, start),
      error,
      poolNote,
    ),
    score.el,
    enginesSection(),
  );

  // ---- stage: the grid, the score alone (boards hidden), or one board watched large ----
  const grid = new BoardGrid((slot) => watch(slot));
  const bigScore = scoreCard();
  bigScore.el.classList.add('big');
  const summary = h('div.match-summary', {}, bigScore.el, h('p.summary-hint', {}, 'Live boards are hidden. Turn them on under “Live boards”.'));
  const empty = h('p.summary-hint', {}, 'Pick two engines (or two versions of one) and start a match.');

  const view = new GameView();
  const watchTitle = h('span.watch-title');
  const back = h('button.btn.ghost.watch-back', { type: 'button', onclick: () => watch(null) }, '← All boards');
  const watchEl = h('div.watch', {}, h('div.watch-bar', {}, back, watchTitle), h('div.watch-board', {}, view.el));
  const movesCard = h('section.moves-card', { hidden: true }, view.movesEl, view.navEl);
  panel.insertBefore(movesCard, score.el.nextSibling);
  let watched: number | null = null;
  let matchId = '';
  /** A one-game match: shown straight on the big board, without the grid. */
  const single = () => store.match?.games === 1;
  const idleLabel = () => {
    if (!store.match?.running) start.textContent = games.get() === 1 ? 'Start game' : 'Start match';
  };

  const stage = h('div.stage.grid-stage');
  const el = h('div.play.match-view', {}, stage, panel);
  new ResizeObserver(() => grid.layout()).observe(stage);

  function watch(slot: number | null) {
    watched = slot;
    conn.send({ t: 'match.watch', slot });
    if (slot === null) view.setGame(null);
    render();
  }

  function render() {
    const m = store.match;
    const mode = watched !== null && m ? 'watch' : !m ? 'empty' : showBoards.get() ? 'grid' : 'summary';
    const child = { watch: watchEl, empty, grid: grid.el, summary }[mode];
    if (stage.firstChild !== child) stage.replaceChildren(child);
    stage.classList.toggle('watching', mode === 'watch');
    movesCard.hidden = mode !== 'watch';
    // The big score in the stage replaces the panel's while the boards are hidden.
    score.el.hidden = mode === 'empty' || mode === 'summary';
    bigScore.el.hidden = false;
    grid.setActive(mode === 'grid');
    back.hidden = single();
    if (mode === 'watch') {
      const b = m!.boards[watched!];
      watchTitle.textContent = single()
        ? `Single game · ${m!.engineA.name} has White`
        : b && b.game >= 0
          ? `Board ${b.slot + 1} · game ${b.game + 1} of ${m!.games.toLocaleString('en')}`
          : `Board ${watched! + 1}`;
    }
  }

  on('match.game', (msg: { slot: number; game: GameState }) => {
    if (msg.slot !== watched) return;
    view.setGame(msg.game);
    render();
  });

  const showError = () => {
    const err = store.match?.error;
    if (err) error.textContent = `Match stopped: ${err}`;
  };
  const sync = () => {
    const m = store.match;
    showError();
    poolNote.textContent = m && !single() ? `${m.boards.length} games on screen · up to ${m.poolSize * 2} moves calculated at once (one per CPU core)` : '';
    start.textContent = m?.running ? 'Stop' : 'Start match';
    start.classList.toggle('stop', !!m?.running);
    idleLabel();
    score.update();
    bigScore.update();
    grid.setBoards(m?.boards ?? []);
    if (m && m.id !== matchId) {
      // A new match: a single game opens on the big board, otherwise show the grid.
      matchId = m.id;
      if (single()) watch(0);
      else if (watched !== null) watch(null);
    } else if (watched !== null && (!m || watched >= m.boards.length)) watch(null);
    render();
  };
  on('match', sync);
  on('match.tick', (changed: MatchBoard[]) => {
    showError();
    start.textContent = store.match?.running ? 'Stop' : 'Start match';
    start.classList.toggle('stop', !!store.match?.running);
    idleLabel();
    score.update();
    bigScore.update();
    grid.update(changed);
    if (watched !== null && changed.some((b) => b.slot === watched)) render();
  });
  on('error', (msg: string) => (error.textContent = msg));
  sync();

  const onKey = (e: KeyboardEvent) => {
    if (watched === null || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const cur = view.ply ?? (view.game?.moves.length ?? 0);
    if (e.key === 'Escape') {
      if (!single()) watch(null);
    }
    else if (e.key === 'ArrowLeft') view.go(cur - 1);
    else if (e.key === 'ArrowRight') view.go(cur + 1);
    else if (e.key === 'ArrowUp' || e.key === 'Home') view.go(0);
    else if (e.key === 'ArrowDown' || e.key === 'End') view.go(null);
    else if (e.key === 'f' || e.key === 'F') view.flip();
    else return;
    e.preventDefault();
  };
  return { el, onKey };
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
  const ends = h('p.sc-ends');
  const el = h(
    'section.score',
    { hidden: true },
    h('div.sc-names', {}, nameA, h('span.sc-vs', {}, 'vs'), nameB),
    h('div.sc-nums', {}, aWins, draws, bWins),
    h('div.sc-labels', {}, h('span', {}, 'A wins'), h('span', {}, 'draws'), h('span', {}, 'B wins')),
    h('div.sc-bar', {}, barA, barD, barB),
    stats,
    ends,
  );
  const update = () => {
    const m = store.match;
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
    // How games ended; engine failures (crash, illegal move, losing on time) stand out.
    const entries = Object.entries(t.ends).sort((x, y) => y[1] - x[1]);
    ends.replaceChildren(
      ...entries.map(([kind, n]) => h(`span.sc-end${FAILURES.has(kind) ? '.bad' : ''}`, {}, `${kind} ${n}`)),
    );
  };
  return { el, update };
}

const FAILURES = new Set(['crash', 'illegal move', 'time', 'failed to start']);

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
  private active = true;

  constructor(private onPick: (slot: number) => void) {
    // Observe the stage, not the grid: the grid's own size follows from the layout.
    piecesReady.then(() => this.cells.forEach((_, i) => this.mark(i)));
  }

  setBoards(boards: MatchBoard[]) {
    if (boards.length !== this.cells.length) {
      this.cells = boards.map(() => {
        const canvas = h('canvas');
        const flash = h('span.mb-flash');
        const el = h('button.mini-board', { type: 'button' }, canvas, flash);
        return { el, canvas, flash, board: null, drawn: '' };
      });
      this.cells.forEach((c, slot) => c.el.addEventListener('click', () => this.onPick(slot)));
      this.el.replaceChildren(...this.cells.map((c) => c.el));
      this.layout();
    }
    this.update(boards);
  }

  /** Inactive (not on screen): keep the latest positions but don't draw or animate. */
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.layout();
      this.cells.forEach((_, i) => this.mark(i));
    }
  }

  update(boards: MatchBoard[]) {
    for (const b of boards) {
      const cell = this.cells[b.slot];
      if (!cell) continue;
      const prev = cell.board;
      cell.board = b;
      // A new game started in this slot: flash how the previous one ended.
      if (this.active && prev && prev.game !== b.game && b.last !== '*') this.flash(cell, b.last, b.lastAWhite);
      cell.el.classList.toggle('done', b.result !== '*');
      cell.el.dataset.result = b.result === '*' ? '' : winner(b.result, b.aWhite);
      cell.el.title = b.game < 0 ? 'Click to watch' : `Game ${b.game + 1}: ${b.aWhite ? 'A' : 'B'} has White${b.result !== '*' ? ` · ${b.result}` : ''} · click to watch`;
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

  /**
   * Fit all boards into the stage as one full rectangle: the column count must
   * divide the number of boards (100 → 10 × 10), so no row is left half empty.
   */
  layout() {
    const n = this.cells.length;
    if (!n || !this.active || !this.el.isConnected) return;
    const gap = n > 64 ? 2 : 3;
    const stage = this.el.parentElement!;
    const w = stage.clientWidth - 40;
    const avail = stage.clientHeight - 40;
    const fit = (cols: number) => {
      const rows = Math.ceil(n / cols);
      const byW = (w - gap * (cols - 1)) / cols;
      return Math.floor(avail > 100 ? Math.min(byW, (avail - gap * (rows - 1)) / rows) : byW);
    };
    let cols = 1;
    let any = 0;
    for (let c = 1; c <= n; c++) {
      any = Math.max(any, fit(c));
      if (n % c === 0 && fit(c) > fit(cols)) cols = c;
    }
    // A board count with few divisors (e.g. a prime) would get tiny boards; allow a ragged row then.
    if (fit(cols) < any * 0.7) for (let c = 1; c <= n; c++) if (fit(c) === any) cols = c;
    // Too many boards for the screen: keep a full rectangle that fits the width and scroll down.
    if (fit(cols) < 40) {
      for (let c = n; c >= 1; c--) if (n % c === 0 && (w - gap * (c - 1)) / c >= 40) { cols = c; break; }
    }
    const size = Math.max(40, fit(cols));
    this.el.style.setProperty('--mb', `${size}px`);
    this.el.style.setProperty('--gap', `${gap}px`);
    this.el.style.gridTemplateColumns = `repeat(${cols}, var(--mb))`;
    if (size !== this.size) {
      this.size = size;
      this.cells.forEach((c, i) => ((c.drawn = ''), this.mark(i)));
    }
  }

  private mark(i: number) {
    if (!this.active) return;
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
