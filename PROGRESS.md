# PROGRESS

Handoff notes for anyone (human or model) continuing this project.

## Rules
- The app only plays **you vs. one UCI engine**. Larger features (engine vs engine, matches, the 100-board grid) are in `PLAN.md` (part 2). Don't build them unless asked.
- Ship no engines. `engines/` is the user's folder and is gitignored. Tests use `tests/fixtures/random-engine.mjs` only.
- Design: dark slate (`#171b22`), stone/slate board, one amber accent (`#f0b44c`), Manrope. Keep the UI to one screen with no menus.
- Commit and push after each milestone.

## Architecture
- `server/uci.ts`: `UciEngine` process wrapper. Handles the handshake, `go` with a hard limit, info/score parsing, crashes, and wrong-OS binary detection.
- `server/engines.ts`: `EngineRegistry`. Scans `ENGINES_DIR`, reads and writes `engines.json`, and probes each engine with a `uci` handshake.
- `core/`: Rust crate wrapping shakmaty, built to WASM (`npm run core` → `core/pkg`, gitignored). It's the only chess logic, shared by server and client. chess.js is gone.
- `server/game.ts`: `Game`, `EnginePlayer`, `HumanPlayer`. Handles clocks, legality via the core `Position`, and how games end.
- `server/host-link.ts` + `host/engine-host.ts`: lets the container run macOS engines on the Mac (see PLAN.md, Engines).
- `server/index.ts`: static server + WebSocket `/ws`. There is a single global play game.
- `shared/protocol.ts`: message types.
- `client/src/board/Board.ts`: DOM board with drag/click, promotion picker, arrows, animated piece sync.
- `client/src/views/GameView.ts`: board + eval bar + player cards + move list + navigation.
- `client/src/views/play.ts`: setup panel. `views/engines.ts`: engine list and file-picker upload.
- Docker: a `rust:1-slim` stage builds `core/pkg`, then `node:22-slim` with python3. `./engines` is mounted at `/engines`. Port 3000. `ENGINE_HOST=host.docker.internal:7100`.

## Checklist
- [x] UCI wrapper, engine discovery, game logic, tests
- [x] Board: drag, click-click, legal dots, promotion picker, arrows/circles, check glow, last-move highlight
- [x] Play view: opponent / color / time, clocks, eval bar, move list, history navigation, resign, sounds
- [x] Docker + compose
- [x] Add engine via file picker (uploads into engines/), remove engines from the list
- [x] Rename engines (click the name)
- [x] Chess rules via shakmaty (WASM), replacing chess.js on server and client
- [x] Engine host: macOS engines while the app runs in Docker
- [ ] PLAN.md part 2 (on hold)

## Log
- 2026-10-21: Built the server and the full client, including a match runner and grid. The user then narrowed the scope to "play vs one engine". Match, grid and viewer code was removed and documented in the roadmap (now PLAN.md) (server match code lives in commit fcc4985). Verified in headless Chrome: drag/click moves, illegal drop snaps back, play as Black, resign, mobile layout. Docker build verified, including the macOS-binary error message.
- 2026-10-21: Add engine now opens the file picker and uploads the file(s) into engines/ (`POST /api/engines/upload`). Removing an engine found by scanning deletes its file. Add-by-path was removed. Roadmap merged into the single PLAN.md. Verified the upload and remove in Docker with headless Chrome.
- 2026-10-21: Finished engine renaming (click the name; scanned engines get an `engines.json` entry with a portable `./file` command). Replaced chess.js with shakmaty compiled to WASM (`core/`). Added the engine host so macOS binaries run from Docker. Verified in Docker: a macOS arm64 engine played through the host from the container, and in headless Chrome: legal dots, a move, the engine's reply, and renaming.
