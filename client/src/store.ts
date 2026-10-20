import type { EngineInfo, GameState } from '../../shared/protocol';
import { conn } from './ws';

type Key = 'engines' | 'play' | 'status' | 'error';

/** App-wide state fed by the server. Views subscribe to the keys they care about. */
export const store = {
  connected: false,
  cores: 4,
  engines: [] as EngineInfo[],
  /** The current game. */
  play: null as GameState | null,
  lastError: '',
};

const subs = new Map<Key, Set<(arg?: any) => void>>();

export function on(key: Key, fn: (arg?: any) => void) {
  if (!subs.has(key)) subs.set(key, new Set());
  subs.get(key)!.add(fn);
  return () => subs.get(key)!.delete(fn);
}

function emit(key: Key, arg?: unknown) {
  subs.get(key)?.forEach((fn) => fn(arg));
}

conn.onStatus = (up) => {
  store.connected = up;
  emit('status');
};

conn.on((msg) => {
  switch (msg.t) {
    case 'hello':
      store.cores = msg.cores;
      break;
    case 'engines':
      store.engines = msg.engines;
      emit('engines');
      break;
    case 'game':
      store.play = msg.game;
      emit('play');
      break;
    case 'error':
      store.lastError = msg.message;
      emit('error', msg.message);
      break;
  }
});
