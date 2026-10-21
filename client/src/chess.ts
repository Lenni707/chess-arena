import init, { Position } from '../../core/pkg/arena_core.js';
import wasmUrl from '../../core/pkg/arena_core_bg.wasm?url';

/** The chess rules (shakmaty compiled to WebAssembly, the same module the server uses). */
export const chessReady = init({ module_or_path: wasmUrl });

export { Position };
