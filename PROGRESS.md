# PROGRESS

Handoff notes for anyone (human or model) continuing this project.

## Rules
- The app only plays **you vs. one UCI engine**. Larger features (engine vs engine, matches, the 100-board grid) are in `ROADMAP.md`. Don't build them unless asked.
- Ship no engines. `engines/` is the user's folder and is gitignored. Tests use `tests/fixtures/random-engine.mjs` only.
- Design: dark slate (`#171b22`), stone/slate board, one amber accent (`#f0b44c`), Manrope. Keep the UI to one screen with no menus.
- Commit and push after each milestone.

## Architecture
- `server/uci.ts`: `UciEngine` process wrapper. Handles the handshake, `go` with a hard limit, info/score parsing, crashes, and wrong-OS binary detection.
- `server/engines.ts`: `EngineRegistry`. Scans `ENGINES_DIR`, reads and writes `engines.json`, and probes each engine with a `uci` handshake.
- `server/game.ts`: `Game`, `EnginePlayer`, `HumanPlayer`. Handles clocks, legality via chess.js, and how games end.
- `server/index.ts`: static server + WebSocket `/ws`. There is a single global play game.
- `shared/protocol.ts`: message types.
- `client/src/board/Board.ts`: DOM board with drag/click, promotion picker, arrows, animated piece sync.
- `client/src/views/GameView.ts`: board + eval bar + player cards + move list + navigation.
- `client/src/views/play.ts`: setup panel. `views/engines.ts`: engine list and add form.
- Docker: multi-stage build on `node:22-slim` with python3. `./engines` is mounted at `/engines`. Port 3000.

## Checklist
- [x] UCI wrapper, engine discovery, game logic, tests
- [x] Board: drag, click-click, legal dots, promotion picker, arrows/circles, check glow, last-move highlight
- [x] Play view: opponent / color / time, clocks, eval bar, move list, history navigation, resign, sounds
- [x] Docker + compose
- [ ] Items in ROADMAP.md (on hold)

## Log
- 2026-10-21: Built the server and the full client, including a match runner and grid. The user then narrowed the scope to "play vs one engine". Match, grid and viewer code was removed and documented in ROADMAP.md (server match code lives in commit fcc4985). Verified in headless Chrome: drag/click moves, illegal drop snaps back, play as Black, resign, mobile layout. Docker build verified, including the macOS-binary error message.
