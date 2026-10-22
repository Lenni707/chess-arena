import type { Color, GameState, MoveRecord } from '../../../shared/protocol';
import { START_FEN } from '../../../shared/protocol';
import { Board } from '../board/Board';
import { Position } from '../chess';
import { fmtClock, h } from '../dom';
import { sound } from '../sound';
import { copyPgn } from '../pgn';

export interface GameViewOptions {
  onMove?: (uci: string) => void;
  /** Play move sounds for incoming moves. */
  sounds?: boolean;
}

/**
 * Board + eval bar + player cards + move list for one game.
 */
export class GameView {
  readonly el: HTMLElement;
  readonly movesEl: HTMLElement;
  readonly navEl: HTMLElement;
  readonly board: Board;
  game: GameState | null = null;
  /** Ply being shown, or null to follow the live position. */
  ply: number | null = null;
  private fens: string[] = [];
  private evalFill: HTMLElement;
  private evalLabel: HTMLElement;
  private cards: Record<'top' | 'bottom', { el: HTMLElement; name: HTMLElement; clock: HTMLElement }>;
  private resultEl: HTMLElement;
  private recvAt = 0;
  private timer: number;
  private dismissed = '';

  constructor(private opts: GameViewOptions = {}) {
    this.board = new Board({ onMove: (uci) => this.opts.onMove?.(uci) });
    const card = (pos: 'top' | 'bottom') => {
      const name = h('span.pc-name');
      const clock = h('span.pc-clock');
      return { el: h(`div.player-card.${pos}`, {}, h('span.pc-dot'), name, clock), name, clock };
    };
    this.cards = { top: card('top'), bottom: card('bottom') };
    this.evalFill = h('div.eval-fill');
    this.evalLabel = h('span.eval-label');
    this.resultEl = h('div.result-banner', {
      title: 'Click to hide',
      onclick: () => {
        this.dismissed = this.game ? `${this.game.id}:${this.game.result}` : '';
        this.resultEl.classList.remove('show');
      },
    });
    this.el = h(
      'div.game-view',
      {},
      h('div.eval-bar', { title: 'Engine evaluation' }, this.evalFill, this.evalLabel),
      h('div.board-col', {}, this.cards.top.el, h('div.board-wrap', {}, this.board.el, this.resultEl), this.cards.bottom.el),
    );
    this.movesEl = h('div.moves');
    const btn = (label: string, icon: string, fn: () => void) =>
      h('button.icon-btn', { 'aria-label': label, title: label, onclick: fn }, icon);
    this.navEl = h(
      'div.nav',
      {},
      btn('First move', '⏮', () => this.go(0)),
      btn('Previous move', '◀', () => this.go((this.ply ?? this.fens.length - 1) - 1)),
      btn('Next move', '▶', () => this.go((this.ply ?? this.fens.length - 1) + 1)),
      btn('Last move', '⏭', () => this.go(null)),
      btn('Flip board (F)', '⇅', () => this.flip()),
      h('button.icon-btn.pgn-btn', { 'aria-label': 'Copy PGN', title: 'Copy the game as PGN (paste it into analysis software)', onclick: (e: Event) => this.copyPgn(e.currentTarget as HTMLButtonElement) }, 'PGN'),
    );
    this.timer = window.setInterval(() => this.renderClocks(), 100);
  }

  private async copyPgn(btn: HTMLButtonElement) {
    if (!this.game) return;
    let label = 'Copied';
    try {
      await copyPgn(this.game);
    } catch {
      label = 'Failed';
    }
    btn.textContent = label;
    btn.classList.toggle('copied', label === 'Copied');
    setTimeout(() => {
      btn.textContent = 'PGN';
      btn.classList.remove('copied');
    }, 1500);
  }

  destroy() {
    clearInterval(this.timer);
  }

  /** The human's color (sets orientation and who may move); null for spectating. */
  setHuman(c: Color | null) {
    if (c) this.board.setOrientation(c);
    this.updateMovable();
  }

  flip() {
    this.board.setOrientation(this.board.flipped ? 'w' : 'b');
    this.renderCards();
  }

  setGame(g: GameState | null) {
    const prev = this.game;
    const isNew = !prev || !g || prev.id !== g.id;
    this.game = g;
    this.recvAt = performance.now();
    if (!g) {
      this.fens = [];
      this.board.setPosition(START_FEN, '', false);
      this.render();
      return;
    }
    // Rebuild FEN history only for the new tail of moves.
    if (isNew) {
      this.fens = [g.startFen];
      this.ply = null;
    }
    if (this.fens.length - 1 > g.moves.length) this.fens = [g.startFen];
    const pos = new Position(this.fens[this.fens.length - 1]);
    for (let i = this.fens.length - 1; i < g.moves.length; i++) {
      pos.play(g.moves[i].uci);
      this.fens.push(pos.fen());
    }
    pos.free();
    if (this.opts.sounds && !isNew && prev) {
      if (g.moves.length > prev.moves.length && this.ply === null) {
        const san = g.moves[g.moves.length - 1].san;
        if (san.includes('x')) sound.capture();
        else sound.move();
        if (/[+#]/.test(san)) sound.check();
      }
      if (prev.result === '*' && g.result !== '*') setTimeout(sound.end, 150);
    }
    this.render(!isNew);
  }

  go(ply: number | null) {
    if (!this.game) return;
    const last = this.fens.length - 1;
    if (ply !== null) ply = Math.max(0, Math.min(last, ply));
    this.ply = ply === last ? null : ply;
    this.render(true);
  }

  private render(animate = true) {
    const g = this.game;
    const last = this.fens.length - 1;
    const ply = this.ply ?? last;
    if (g) {
      const lm = ply > 0 ? g.moves[ply - 1]?.uci ?? '' : '';
      this.board.setPosition(this.fens[ply], lm, animate);
    }
    this.updateMovable();
    this.renderCards();
    this.renderMoves();
    this.renderEval();
    this.renderResult();
  }

  private updateMovable() {
    const g = this.game;
    const live = g && g.result === '*' && this.ply === null;
    const turn = g ? (g.moves.length % 2 === 0 ? 'w' : 'b') : null;
    const humanTurn =
      live && turn && ((turn === 'w' && g!.white.ref === 'human') || (turn === 'b' && g!.black.ref === 'human'));
    this.board.setMovable(humanTurn ? turn : null);
  }

  private renderCards() {
    const g = this.game;
    const topColor: Color = this.board.flipped ? 'w' : 'b';
    for (const pos of ['top', 'bottom'] as const) {
      const color: Color = pos === 'top' ? topColor : topColor === 'w' ? 'b' : 'w';
      const c = this.cards[pos];
      const p = g ? (color === 'w' ? g.white : g.black) : null;
      c.name.textContent = p ? p.name : color === 'w' ? 'White' : 'Black';
      c.el.dataset.color = color;
    }
    this.renderClocks();
  }

  private renderClocks() {
    const g = this.game;
    const topColor: Color = this.board.flipped ? 'w' : 'b';
    for (const pos of ['top', 'bottom'] as const) {
      const color: Color = pos === 'top' ? topColor : topColor === 'w' ? 'b' : 'w';
      const c = this.cards[pos];
      if (!g || g.clock.tc.kind !== 'clock') {
        c.clock.textContent = '';
        c.el.classList.toggle('active', !!g && g.result === '*' && g.clock.running === color);
        continue;
      }
      let ms = g.clock[color];
      const running = g.result === '*' && g.clock.running === color;
      if (running) ms -= performance.now() - this.recvAt;
      c.clock.textContent = fmtClock(ms);
      c.el.classList.toggle('active', running);
      c.el.classList.toggle('low', running && ms < 10_000);
    }
  }

  private renderMoves() {
    const g = this.game;
    const list = this.movesEl;
    list.replaceChildren();
    if (!g) return;
    const cur = this.ply ?? g.moves.length;
    const rows: HTMLElement[] = [];
    for (let i = 0; i < g.moves.length; i += 2) {
      const cell = (k: number, m?: MoveRecord) =>
        m
          ? h(
              'button.mv',
              {
                class: k + 1 === cur ? 'current' : undefined,
                onclick: () => this.go(k + 1),
              },
              m.san,
            )
          : h('span.mv.empty');
      rows.push(h('div.mv-row', {}, h('span.mv-num', {}, `${i / 2 + 1}`), cell(i, g.moves[i]), cell(i + 1, g.moves[i + 1])));
    }
    list.append(...rows);
    const current = list.querySelector('.current') as HTMLElement | null;
    if (current) current.scrollIntoView({ block: 'nearest' });
    else list.scrollTop = list.scrollHeight;
  }

  private renderEval() {
    const g = this.game;
    let ev: MoveRecord['eval'] | undefined;
    if (g) {
      const upto = this.ply ?? g.moves.length;
      for (let i = upto - 1; i >= 0 && i >= upto - 2; i--) if (g.moves[i]?.eval) {
        ev = g.moves[i].eval;
        break;
      }
    }
    let pct = 50;
    let label = '';
    if (ev?.mate !== undefined) {
      pct = ev.mate > 0 ? 100 : 0;
      label = `M${Math.abs(ev.mate)}`;
    } else if (ev?.cp !== undefined) {
      pct = 50 + 50 * (2 / (1 + Math.exp(-ev.cp / 400)) - 1);
      label = (Math.abs(ev.cp) / 100).toFixed(1);
    }
    if (g?.result === '1-0') pct = 100;
    if (g?.result === '0-1') pct = 0;
    // The fill shows White's share from the bottom (or top when flipped).
    this.evalFill.style.height = `${pct}%`;
    this.evalFill.parentElement!.classList.toggle('flipped', this.board.flipped);
    this.evalLabel.textContent = label;
    this.evalLabel.classList.toggle('white-ahead', pct >= 50);
  }

  private renderResult() {
    const g = this.game;
    const el = this.resultEl;
    const key = g ? `${g.id}:${g.result}` : '';
    if (!g || g.result === '*' || this.ply !== null || this.dismissed === key) {
      el.classList.remove('show');
      return;
    }
    const winner = g.result === '1-0' ? g.white.name : g.result === '0-1' ? g.black.name : null;
    el.replaceChildren(
      ...[
      h('div.rb-score', {}, g.result.replace('1/2-1/2', '½–½').replace('-', '–')),
      h('div.rb-title', {}, winner ? `${winner} won` : g.reason === 'stopped' ? 'Game stopped' : 'Draw'),
      g.reason && g.reason !== 'stopped' ? h('div.rb-reason', {}, g.reason) : null,
      ].filter((x): x is HTMLDivElement => x !== null),
    );
    el.classList.add('show');
  }
}
