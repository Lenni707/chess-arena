import { Chess, type Square } from 'chess.js';
import type { Color } from '../../../shared/protocol';
import { h } from '../dom';
import { parseFen, pieceUrl } from '../pieces';

export interface BoardOptions {
  /** Called with a uci move after the user moves a piece. */
  onMove?: (uci: string) => void;
}

interface PieceEl {
  el: HTMLDivElement;
  code: string;
  sq: string;
}

const FILES = 'abcdefgh';

/**
 * Main interactive board: drag or click to move, right-drag to draw arrows,
 * right-click to mark squares. The board only shows legal moves for `movable`.
 */
export class Board {
  readonly el: HTMLDivElement;
  private piecesLayer: HTMLDivElement;
  private marksLayer: HTMLDivElement;
  private arrowsSvg: SVGSVGElement;
  private coords: HTMLDivElement;
  private promo: HTMLDivElement;
  private pieces: PieceEl[] = [];
  private fen = '';
  private chess = new Chess();
  private orientation: Color = 'w';
  private movable: Color | null = null;
  private lastMove = '';
  private selected: string | null = null;
  private drag: { piece: PieceEl; x0: number; y0: number; active: boolean } | null = null;
  private hover: string | null = null;
  private arrows = new Map<string, true>();
  private circles = new Set<string>();
  private rightFrom: string | null = null;

  constructor(private opts: BoardOptions = {}) {
    this.marksLayer = h('div.b-marks');
    this.piecesLayer = h('div.b-pieces');
    this.arrowsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.arrowsSvg.setAttribute('class', 'b-arrows');
    this.arrowsSvg.setAttribute('viewBox', '0 0 8 8');
    this.coords = h('div.b-coords');
    this.promo = h('div.b-promo');
    this.el = h('div.board', {}, this.coords, this.marksLayer, this.piecesLayer, this.arrowsSvg, this.promo);
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointermove', (e) => this.onMoveEvt(e));
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('pointercancel', () => this.cancelDrag());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.renderCoords();
  }

  setOrientation(c: Color) {
    if (c === this.orientation) return;
    this.orientation = c;
    this.renderCoords();
    for (const p of this.pieces) this.place(p.el, p.sq);
    this.renderMarks();
    this.renderArrows();
  }

  get flipped() {
    return this.orientation === 'b';
  }

  /** Which side the user may move right now, or null. */
  setMovable(c: Color | null) {
    this.movable = c;
    if (!c) this.select(null);
    this.renderMarks();
  }

  setPosition(fen: string, lastMove = '', animate = true) {
    if (fen === this.fen && lastMove === this.lastMove) return;
    const changed = fen !== this.fen;
    this.fen = fen;
    this.lastMove = lastMove;
    try {
      this.chess.load(fen);
    } catch {
      return;
    }
    if (changed) {
      this.selected = null;
      this.clearAnnotations();
      this.syncPieces(animate);
    }
    this.renderMarks();
  }

  // ---------- pieces ----------

  private syncPieces(animate: boolean) {
    const target = parseFen(this.fen);
    const want: { code: string; sq: string }[] = [];
    target.forEach((code, i) => code && want.push({ code, sq: FILES[i % 8] + (8 - Math.floor(i / 8)) }));

    const old = [...this.pieces];
    const next: PieceEl[] = [];
    const pending: { code: string; sq: string }[] = [];
    // Keep pieces that stay put.
    for (const w of want) {
      const k = old.findIndex((p) => p.sq === w.sq && p.code === w.code);
      if (k >= 0) next.push(old.splice(k, 1)[0]);
      else pending.push(w);
    }
    // Move the nearest leftover piece of the same kind, else create a new one.
    for (const w of pending) {
      let best = -1;
      let bestD = Infinity;
      old.forEach((p, k) => {
        if (p.code !== w.code) return;
        const d = dist(p.sq, w.sq);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (best >= 0) {
        const p = old.splice(best, 1)[0];
        p.sq = w.sq;
        p.el.classList.toggle('anim', animate);
        this.place(p.el, w.sq);
        next.push(p);
      } else {
        const el = h('div.piece');
        el.style.backgroundImage = `url(${pieceUrl(w.code)})`;
        this.place(el, w.sq);
        this.piecesLayer.append(el);
        next.push({ el, code: w.code, sq: w.sq });
      }
    }
    for (const p of old) {
      if (animate) {
        p.el.classList.add('captured');
        setTimeout(() => p.el.remove(), 200);
      } else p.el.remove();
    }
    this.pieces = next;
  }

  private place(el: HTMLElement, sq: string) {
    const [x, y] = this.xy(sq);
    el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  }

  private xy(sq: string): [number, number] {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]) - 1;
    return this.flipped ? [7 - f, r] : [f, 7 - r];
  }

  private sqAt(clientX: number, clientY: number): string | null {
    const r = this.el.getBoundingClientRect();
    let x = Math.floor(((clientX - r.left) / r.width) * 8);
    let y = Math.floor(((clientY - r.top) / r.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    if (this.flipped) x = 7 - x;
    else y = 7 - y;
    return FILES[x] + (y + 1);
  }

  // ---------- input ----------

  private onDown(e: PointerEvent) {
    if (this.promo.classList.contains('open')) return;
    const sq = this.sqAt(e.clientX, e.clientY);
    if (!sq) return;
    if (e.button === 2) {
      this.rightFrom = sq;
      return;
    }
    if (e.button !== 0) return;
    this.clearAnnotations();
    const piece = this.chess.get(sq as Square);
    const own = piece && piece.color === this.movable && this.chess.turn() === this.movable;

    if (this.selected && this.selected !== sq && this.dests(this.selected).includes(sq)) {
      this.tryMove(this.selected, sq);
      return;
    }
    if (!own) {
      this.select(null);
      return;
    }
    const p = this.pieces.find((x) => x.sq === sq);
    if (!p) return;
    const wasSelected = this.selected === sq;
    this.select(sq);
    this.drag = { piece: p, x0: e.clientX, y0: e.clientY, active: false };
    (this.drag as any).wasSelected = wasSelected;
    this.el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private onMoveEvt(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 3) {
      d.active = true;
      d.piece.el.classList.remove('anim');
      d.piece.el.classList.add('dragging');
    }
    if (!d.active) return;
    const r = this.el.getBoundingClientRect();
    const size = r.width / 8;
    const x = e.clientX - r.left - size / 2;
    const y = e.clientY - r.top - size / 2;
    d.piece.el.style.transform = `translate(${x}px, ${y}px)`;
    const over = this.sqAt(e.clientX, e.clientY);
    if (over !== this.hover) {
      this.hover = over;
      this.renderMarks();
    }
  }

  private onUp(e: PointerEvent) {
    if (e.button === 2 && this.rightFrom) {
      const to = this.sqAt(e.clientX, e.clientY);
      if (to) this.annotate(this.rightFrom, to);
      this.rightFrom = null;
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.hover = null;
    d.piece.el.classList.remove('dragging');
    const to = this.sqAt(e.clientX, e.clientY);
    const from = d.piece.sq;
    if (d.active) {
      if (to && to !== from && this.dests(from).includes(to)) {
        this.place(d.piece.el, to);
        this.tryMove(from, to, false);
        return;
      }
      this.place(d.piece.el, from);
      this.renderMarks();
      return;
    }
    // A plain click on an already selected piece deselects it.
    if ((d as any).wasSelected && to === from) this.select(null);
  }

  private cancelDrag() {
    if (!this.drag) return;
    this.drag.piece.el.classList.remove('dragging');
    this.place(this.drag.piece.el, this.drag.piece.sq);
    this.drag = null;
    this.hover = null;
    this.renderMarks();
  }

  private select(sq: string | null) {
    this.selected = sq;
    this.renderMarks();
  }

  private dests(from: string): string[] {
    return this.chess.moves({ square: from as Square, verbose: true }).map((m) => m.to);
  }

  private async tryMove(from: string, to: string, animate = true) {
    const piece = this.chess.get(from as Square);
    let promotion: string | undefined;
    if (piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      promotion = await this.askPromotion(to, piece.color);
      if (!promotion) {
        this.syncPieces(false);
        this.select(null);
        return;
      }
    }
    const mv = this.chess.move({ from, to, promotion });
    this.fen = this.chess.fen();
    this.lastMove = mv.lan;
    this.selected = null;
    this.syncPieces(animate);
    this.renderMarks();
    this.opts.onMove?.(mv.lan);
  }

  private askPromotion(sq: string, color: Color): Promise<string | undefined> {
    return new Promise((resolve) => {
      const [x, y] = this.xy(sq);
      const down = y === 0;
      this.promo.replaceChildren();
      ['q', 'n', 'r', 'b'].forEach((p, k) => {
        const btn = h('button.promo-piece', {
          'aria-label': { q: 'Queen', n: 'Knight', r: 'Rook', b: 'Bishop' }[p],
          onclick: (e: Event) => {
            e.stopPropagation();
            close(p);
          },
        });
        btn.style.backgroundImage = `url(${pieceUrl(color + p)})`;
        btn.style.left = `${x * 12.5}%`;
        btn.style.top = `${(down ? y + k : y - k) * 12.5}%`;
        this.promo.append(btn);
      });
      const close = (p?: string) => {
        this.promo.classList.remove('open');
        this.promo.onpointerdown = null;
        resolve(p);
      };
      this.promo.onpointerdown = (e) => {
        if (e.target === this.promo) close();
      };
      this.promo.classList.add('open');
    });
  }

  // ---------- marks ----------

  private renderMarks() {
    const marks: HTMLElement[] = [];
    const add = (sq: string, cls: string) => {
      const el = h(`div.mark.${cls}`);
      this.place(el, sq);
      marks.push(el);
    };
    if (this.lastMove) {
      add(this.lastMove.slice(0, 2), 'last');
      add(this.lastMove.slice(2, 4), 'last');
    }
    if (this.chess.inCheck()) {
      const k = this.chess.findPiece({ type: 'k', color: this.chess.turn() })[0];
      if (k) add(k, 'check');
    }
    for (const sq of this.circles) add(sq, 'circle');
    if (this.selected) {
      add(this.selected, 'selected');
      for (const m of this.chess.moves({ square: this.selected as Square, verbose: true })) {
        add(m.to, m.captured || m.isEnPassant() ? 'capture-dest' : 'dest');
      }
    }
    if (this.hover && this.drag?.active) add(this.hover, 'hover');
    this.marksLayer.replaceChildren(...marks);
  }

  private renderCoords() {
    this.coords.replaceChildren();
    for (let i = 0; i < 8; i++) {
      const file = this.flipped ? FILES[7 - i] : FILES[i];
      const rank = this.flipped ? i + 1 : 8 - i;
      const f = h('span.coord.file', {}, file);
      f.style.left = `${i * 12.5}%`;
      f.classList.add(i % 2 === 0 ? 'on-dark' : 'on-light');
      const r = h('span.coord.rank', {}, String(rank));
      r.style.top = `${i * 12.5}%`;
      r.classList.add(i % 2 === 0 ? 'on-light' : 'on-dark');
      this.coords.append(f, r);
    }
  }

  // ---------- arrows ----------

  private clearAnnotations() {
    if (!this.arrows.size && !this.circles.size) return;
    this.arrows.clear();
    this.circles.clear();
    this.renderArrows();
    this.renderMarks();
  }

  private annotate(from: string, to: string) {
    if (from === to) {
      if (this.circles.has(from)) this.circles.delete(from);
      else this.circles.add(from);
      this.renderMarks();
      return;
    }
    const key = from + to;
    if (this.arrows.has(key)) this.arrows.delete(key);
    else this.arrows.set(key, true);
    this.renderArrows();
  }

  private renderArrows() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = this.arrowsSvg;
    svg.replaceChildren();
    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML =
      '<marker id="ah" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto"><path d="M0,0 V4 L3,2 Z" fill="var(--arrow)"/></marker>';
    svg.append(defs);
    for (const key of this.arrows.keys()) {
      const [x1, y1] = this.xy(key.slice(0, 2));
      const [x2, y2] = this.xy(key.slice(2, 4));
      const len = Math.hypot(x2 - x1, y2 - y1);
      const shorten = 0.35 / len;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(x1 + 0.5));
      line.setAttribute('y1', String(y1 + 0.5));
      line.setAttribute('x2', String(x1 + 0.5 + (x2 - x1) * (1 - shorten)));
      line.setAttribute('y2', String(y1 + 0.5 + (y2 - y1) * (1 - shorten)));
      line.setAttribute('class', 'arrow');
      line.setAttribute('marker-end', 'url(#ah)');
      svg.append(line);
    }
  }
}

function dist(a: string, b: string) {
  return Math.hypot(a.charCodeAt(0) - b.charCodeAt(0), Number(a[1]) - Number(b[1]));
}
