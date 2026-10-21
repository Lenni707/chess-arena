import './styles.css';
import { chessReady } from './chess';
import { h } from './dom';
import { on, store } from './store';
import { conn } from './ws';
import { playView } from './views/play';
import { matchView } from './views/match';

await chessReady;
const play = playView();
const match = matchView();
const offline = h('div.offline', { role: 'status' }, 'Reconnecting to the server…');
const main = h('main', {}, play.el);

// Two screens: you vs. an engine, and engine vs. engine matches.
type Mode = 'play' | 'match';
const tabs = (['play', 'match'] as Mode[]).map((m) =>
  h('button.tab', { type: 'button', role: 'tab', onclick: () => show(m) }, m === 'play' ? 'Play' : 'Match'),
);
function show(mode: Mode) {
  main.replaceChildren(mode === 'play' ? play.el : match.el);
  tabs.forEach((t, i) => t.setAttribute('aria-selected', String((i === 0) === (mode === 'play'))));
  try {
    localStorage.setItem('mode', mode);
  } catch {}
}
let saved: string | null = null;
try {
  saved = localStorage.getItem('mode');
} catch {}
show(saved === 'match' ? 'match' : 'play');

const top = h('header.top', {}, h('div.brand', {}, h('img', { src: '/pieces/wN.svg', alt: '' }), 'Arena'), h('nav.tabs', { role: 'tablist' }, ...tabs));

document.getElementById('app')!.append(top, main, offline);
window.addEventListener('keydown', (e) => (main.contains(play.el) ? play.onKey(e) : match.onKey(e)));

on('status', () => offline.classList.toggle('show', !store.connected));
conn.connect();
