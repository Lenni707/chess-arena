import type { Color, TimeControl } from '../../../shared/protocol';
import { h } from '../dom';
import { on, store } from '../store';
import { conn } from '../ws';
import { GameView } from './GameView';
import { chips, enginesSection, engineSelect, strengthSelect } from './engines';

const TIME_CONTROLS: { label: string; value: TimeControl }[] = [
  { label: '1 + 0', value: { kind: 'clock', baseMs: 60_000, incMs: 0 } },
  { label: '3 + 2', value: { kind: 'clock', baseMs: 180_000, incMs: 2000 } },
  { label: '10 + 5', value: { kind: 'clock', baseMs: 600_000, incMs: 5000 } },
  { label: '30 + 0', value: { kind: 'clock', baseMs: 1_800_000, incMs: 0 } },
  { label: 'No clock', value: { kind: 'movetime', ms: 1000 } },
];

export function playView(): { el: HTMLElement; onKey: (e: KeyboardEvent) => void } {
  const view = new GameView({ sounds: true, onMove: (uci) => store.play && conn.send({ t: 'play.move', gameId: store.play.id, uci }) });
  const engine = engineSelect('Opponent');
  const strength = strengthSelect(engine, 'Opponent strength');
  const color = chips<Color | 'random'>(
    [
      { label: 'White', value: 'w' },
      { label: 'Black', value: 'b' },
      { label: 'Random', value: 'random' },
    ],
    0,
  );
  const tc = chips(TIME_CONTROLS, 2);
  const error = h('p.form-error', { role: 'alert' });

  const start = h('button.btn.primary', {
    type: 'button',
    onclick: () => {
      if (!engine.value) {
        error.textContent = 'Add an engine first (see Engines below).';
        return;
      }
      const pick = color.get();
      const you: Color = pick === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
      conn.send({
        t: 'play.new',
        white: you === 'w' ? 'human' : engine.value,
        black: you === 'b' ? 'human' : engine.value,
        tc: tc.get(),
        elo: you === 'w' ? { b: strength.value() } : { w: strength.value() },
      });
    },
  }, 'New game');
  const resign = h('button.btn.ghost', { type: 'button', onclick: () => store.play && conn.send({ t: 'play.resign', gameId: store.play.id }) }, 'Resign');

  const panel = h(
    'aside.panel',
    {},
    h('section.setup', {},
      h('div.field', {}, h('span', {}, 'Opponent'), h('div.engine-pick', {}, engine, strength.el)),
      h('div.field', {}, h('span', {}, 'You play'), color.el),
      h('div.field', {}, h('span', {}, 'Time (minutes + seconds per move)'), tc.el),
      h('div.actions', {}, start, resign),
      error,
    ),
    h('section.moves-card', {}, view.movesEl, view.navEl),
    enginesSection(),
  );

  const el = h('div.play', {}, h('div.stage', {}, view.el), panel);

  let lastId = '';
  const sync = () => {
    const g = store.play;
    if (g && g.id !== lastId) {
      lastId = g.id;
      view.setHuman(g.white.ref === 'human' ? 'w' : 'b');
    }
    view.setGame(g);
    const live = !!g && g.result === '*';
    resign.toggleAttribute('disabled', !live);
    start.textContent = live ? 'Restart' : 'New game';
    error.textContent = '';
  };
  on('play', sync);
  on('error', (m: string) => (error.textContent = m));
  sync();

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const cur = view.ply ?? (view.game?.moves.length ?? 0);
    if (e.key === 'ArrowLeft') view.go(cur - 1);
    else if (e.key === 'ArrowRight') view.go(cur + 1);
    else if (e.key === 'ArrowUp' || e.key === 'Home') view.go(0);
    else if (e.key === 'ArrowDown' || e.key === 'End') view.go(null);
    else if (e.key === 'f' || e.key === 'F') view.flip();
    else return;
    e.preventDefault();
  };
  return { el, onKey };
}
