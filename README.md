# Chess Arena

A clean chess GUI for playing against your own UCI engines. You can move pieces by dragging or by clicking, as on chess.com.

![](docs/screenshot.png)

## Run it

```sh
docker compose up --build -d
npm run engine-host        # only for macOS engines; keep it running (Node 22.18+, no npm install needed)
open http://localhost:3000
```

Without Docker: `npm install`, then `npm run dev` and open http://localhost:5173. This needs Node 22+, Rust with `rustup target add wasm32-unknown-unknown`, and `cargo install wasm-bindgen-cli --version 0.2.129`.

## Add your engines

Click **Add engine** and pick the engine file in your file manager. It's copied into the `engines/` folder. To include network files (NNUE etc.), select them together with the engine. You can also drop engines into `engines/` yourself and click **Rescan engines folder**.

- Executables, `*.py` and `*.js` files (top level or one folder deep) are found automatically. The engine runs with its own folder as the working directory, so NNUE files next to it load.
- **macOS engines with Docker:** the container runs Linux, so native macOS binaries run on your Mac through the **engine host** (`npm run engine-host`). The container connects to it on `host.docker.internal:7100`, and those engines show a `macOS` tag. Linux builds and `*.py`/`*.js` engines run inside the container. To run a script engine on the Mac as well, add `"host": true` to its `engines.json` entry.
- The engine host only starts files inside `engines/`. It listens on 127.0.0.1 only and requires the token in `engines/.engine-host-token`, which it creates on first start.
- Click an engine's name to rename it.
- Names, arguments and UCI options go in `engines/engines.json`:

```json
[{ "name": "My Engine", "command": "my-engine/engine", "args": [], "options": { "Hash": 64, "Threads": 2 } }]
```

## Controls

| Action | How |
| --- | --- |
| Move | Drag a piece, or click it and then click the target square |
| Draw an arrow / mark a square | Right-drag / right-click (left-click clears) |
| Step through moves | ← → (↑ first move, ↓ back to live) |
| Flip board | F |

## Development

```sh
npm run dev        # builds core/, then server (tsx watch) + Vite client
npm test           # cargo tests for core/ + vitest (UCI, game rules, engine host)
npm run typecheck
npm run core       # rebuild the chess rules (core/ → core/pkg) after editing Rust
```

Chess rules (legal moves, SAN, FEN, checkmate, repetition, 50-move rule, insufficient material) come from [shakmaty](https://crates.io/crates/shakmaty). It's compiled to WebAssembly in `core/`, and the server and the browser load the same module.

Everything (built and planned, including engine-vs-engine matches and the 100+ board grid) is in [PLAN.md](PLAN.md).

Piece set: cburnett by Colin M.L. Burnett (GPLv2+), from lichess.
