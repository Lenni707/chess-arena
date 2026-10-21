import { readFileSync } from 'node:fs';
import { initSync, Position } from '../core/pkg/arena_core.js';

// The chess rules are shakmaty compiled to WebAssembly (core/); load it once.
initSync({ module: readFileSync(new URL('../core/pkg/arena_core_bg.wasm', import.meta.url)) });

export { Position };
