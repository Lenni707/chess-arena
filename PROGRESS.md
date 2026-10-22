# PROGRESS

Handoff notes for anyone (human or model) continuing this project.

## Rules
- Two tabs: **Play** (you vs. one engine) and **Match** (engine A vs. B, many games, live board grid). Keep the scope tight: the user asked explicitly for no opening book, no extra engines and no extras they didn't ask for.
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
- [x] Engine versions (`engines/<engine>/<version>/`, "+ version" upload, auto-migration to v1)
- [x] Match tab: 100–10,000 games, up to 200 live canvas boards, tally + Elo
- [x] Elo strength picker for engines with UCI_Elo (Play and Match)
- [x] Engine pools for matches (bounded processes, accurate CPU per move, errors visible)
- [x] Single engine-vs-engine game (Games = 1)
- [ ] Rest of PLAN.md part 2 (only when asked)

## Log
- 2026-10-21: Built the server and the full client, including a match runner and grid. The user then narrowed the scope to "play vs one engine". Match, grid and viewer code was removed and documented in the roadmap (now PLAN.md) (server match code lives in commit fcc4985). Verified in headless Chrome: drag/click moves, illegal drop snaps back, play as Black, resign, mobile layout. Docker build verified, including the macOS-binary error message.
- 2026-10-21: Add engine now opens the file picker and uploads the file(s) into engines/ (`POST /api/engines/upload`). Removing an engine found by scanning deletes its file. Add-by-path was removed. Roadmap merged into the single PLAN.md. Verified the upload and remove in Docker with headless Chrome.
- 2026-10-21: Finished engine renaming (click the name; scanned engines get an `engines.json` entry with a portable `./file` command). Replaced chess.js with shakmaty compiled to WASM (`core/`). Added the engine host so macOS binaries run from Docker. Verified in Docker: a macOS arm64 engine played through the host from the container, and in headless Chrome: legal dots, a move, the engine's reply, and renaming.
- 2026-10-21: Engine versions, plus the Match tab with live mini boards. Verified in Docker with the user's macOS engine: an uploaded v2 moved the old file into v1, and v2 vs v1 ran 1000 games with 100 boards at once in headless Chrome (200 games in ~25 s at 20 ms/move). Stop works. The user rejected an opening book, so it was removed.
- 2026-10-21: The user asked for Stockfish. Installed the official Stockfish 19 Linux arm64 build (sf_19 release) into the user's `engines/stockfish/19/` with its GPL `Copying.txt`. It isn't committed (`engines/` is gitignored), and it runs inside the container. Added Elo strength picking. Verified: the GUI shows Elo 1320–3190, and Stockfish at Elo 1320 lost 8/8 to full strength.
- 2026-10-22: Stress test showed the per-board engine design breaks at 100 boards (memory full, 257/300 games ended by errors). Replaced it with shared engine pools (`server/pool.ts`). Added end-reason counts to the match tally, and the single-game option. The 100-board stress test has NOT been rerun yet on the pool version.
