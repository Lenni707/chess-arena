import './styles.css';
import { h } from './dom';
import { on, store } from './store';
import { conn } from './ws';
import { playView } from './views/play';

const play = playView();
const offline = h('div.offline', { role: 'status' }, 'Reconnecting to the server…');
const top = h('header.top', {}, h('div.brand', {}, h('img', { src: '/pieces/wN.svg', alt: '' }), 'Arena'));

document.getElementById('app')!.append(top, h('main', {}, play.el), offline);
window.addEventListener('keydown', play.onKey);

on('status', () => offline.classList.toggle('show', !store.connected));
conn.connect();
