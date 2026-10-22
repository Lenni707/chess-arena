# Chess Arena: full plan

This one file has the whole project: what the app is, what's built, how it works, and what's planned.

## The idea

A clean, modern chess GUI for your own UCI engines:
- moves work like chess.com (drag or click)
- adding an engine is as easy as picking its file
- no extra menus

The full vision also covers engines playing each other: matches with many games, a clear view of who won, and a satisfying grid of 100+ live boards. Part 1 (play against one engine) and the core of part 2 (engine versions, matches, the live board grid) are built. The rest of part 2 is listed below.

# Part 1: Play against an engine (built)

## Running it

```sh
docker compose up --build -d     # then open http://localhost:3000
npm run engine-host              # on the Mac, for macOS engines while using Docker
npm install && npm run dev       # without Docker (needs Rust + wasm-bindgen-cli), then open http://localhost:5173
```

## Screen

There is one screen. The board is on the left, with the eval bar, and player cards with clocks above and below the board. The panel on the right has:
- **Opponent:** any working engine.
- **You play:** White, Black or Random. The board turns so your side is at the bottom.
- **Time:** 1+0, 3+2, 10+5, 30+0, or No clock (the engine thinks 1 s per move).
- **New game / Restart** and **Resign**.
- **Move list:** click a move to view that position. Buttons go to the first, previous, next and last move, and flip the board.
- **Engines:** the list of your engines, with a status dot and the reason if one fails.
  - **Add engine** opens your file manager.
  - Click a name to rename it (saved in `engines.json`).
  - **×** removes an engine.
  - A `macOS` tag means the engine runs on the engine host.
  - **Rescan engines folder** looks for new files.

## Controls

| Action | How |
| --- | --- |
| Move | Drag a piece, or click it and then click the target square (legal squares show dots or rings) |
| Promote | A picker opens on the promotion square (queen, knight, rook, bishop) |
| Arrow / mark | Right-drag draws an arrow, right-click circles a square, left-click clears them |
| Step through moves | ← →; ↑ goes to the first move, ↓ back to the live position |
| Flip board | F |

You also get the last-move highlight, a red glow when a king is in check, move, capture and end-of-game sounds, a clock that turns red under 10 s, and a result card at the end of the game (click it to hide it).

## Engines

- **Add engine** opens your file manager. The chosen file is copied into the `engines/` folder and made executable.
  - To add an engine with its network files (NNUE etc.), select all the files together. They are kept side by side in one folder.
- Files you put in `engines/` yourself are found too: executables, `*.py`, `*.js`, at the top level or one folder deep.
- Optional `engines/engines.json` sets names, arguments and UCI options:
  `[{ "name": "My Engine", "command": "my-engine/engine", "options": { "Hash": 64, "Threads": 2 } }]`
- Each engine is checked with a `uci`/`uciok` handshake. If it fails, the list says why, for example "this is a macOS binary; inside Docker the engine needs a Linux build".
- **Docker runs Linux, so macOS engines go through the engine host.** `npm run engine-host` (`host/engine-host.ts`, plain Node with no dependencies) runs on the Mac and listens on 127.0.0.1:7100. The server in the container connects to `ENGINE_HOST=host.docker.internal:7100` and keeps retrying. When the host connects or disconnects, the engines list is re-probed.
  - Mach-O binaries are started on the host automatically. `"host": true` in `engines.json` forces any engine onto the host.
  - Wire format: JSON lines. `hello{token}` → `ready{platform,arch}`, then `spawn{id,command,args}`, `in{id,line}`, `quit{id}` ⇄ `out{id,line}`, `exit{id,reason}`. Paths inside the engines folder are sent as `$ENGINES/…`, and the host maps them to its own folder.
  - Safety: the host only starts files inside its engines folder (or `node`/`python3` with a script there). It requires the token in `engines/.engine-host-token`, which it creates on first start. The server rejects uploads and WebSockets whose `Origin` is a different site, so other websites can't plant and run an engine.
- Linux builds and script engines (Python 3 and Node are in the image) run inside the container. With `npm run dev` on the Mac, everything runs natively.
- No engines are bundled.

## Engine strength

- During the `uci` handshake, `UciEngine` reads `option name UCI_Elo … min … max …`. The range counts only if `UCI_LimitStrength` is offered too. The registry's check stores it as `EngineInfo.elo`.
- `play.new {elo: {w?, b?}}` and `match.start {eloA?, eloB?}` choose a strength. `registry.def(engine, elo)` adds `UCI_LimitStrength=true` and `UCI_Elo=<elo>` (clamped to the range) to the engine's options. The player's name gets " (Elo N)".
- The dropdown (`strengthSelect` in `client/src/views/engines.ts`) lists Full strength, the minimum, every 100 in between, and the maximum.

## How games are run

- The server owns the game and checks every move with shakmaty (see below). A browser move that isn't legal is rejected, and the board resyncs.
- Engines get `position startpos moves …` and `go wtime btime winc binc`, or `go movetime` when there is no clock.
- How a game ends:
  - checkmate, stalemate, threefold repetition, the 50-move rule, insufficient material
  - running out of time, except it's a draw if the opponent can't checkmate (shakmaty's `has_insufficient_material`)
  - resignation
  - an engine crash, hang or illegal move, which loses for that engine
- The eval bar uses the engine's last `info score`, converted to White's point of view.

## Architecture

| Part | File |
| --- | --- |
| Chess rules: shakmaty compiled to WebAssembly (`Position`: legal moves, SAN, FEN, outcome, repetition) | `core/src/lib.rs` → `core/pkg` |
| Loads the WASM rules (server / browser) | `server/chess.ts`, `client/src/chess.ts` |
| UCI process wrapper: handshake, `go` with hard time limit, score parsing, crash and wrong-OS detection, local vs. engine-host placement | `server/uci.ts` |
| Link from the server to the engine host | `server/host-link.ts` |
| Engine host (runs on the Mac) | `host/engine-host.ts` |
| Engine discovery, `engines.json`, upload and remove | `server/engines.ts` |
| Game, clocks, human and engine players, game-end rules | `server/game.ts` |
| HTTP (static files, `POST /api/engines/upload`) + WebSocket `/ws` | `server/index.ts` |
| Message types shared by client and server | `shared/protocol.ts` |
| Interactive board (drag, click, promotion, arrows, animation) | `client/src/board/Board.ts` |
| Board + eval bar + clocks + move list | `client/src/views/GameView.ts` |
| Setup panel / engines panel (versions) | `client/src/views/play.ts`, `client/src/views/engines.ts` |
| Match runner (parallel slots, tally) | `server/match.ts` |
| Match tab: settings, score, canvas board grid | `client/src/views/match.ts` |

Stack: Node 22 + TypeScript, `ws`, shakmaty 0.30 (Rust → WASM via wasm-bindgen 0.2.129, built without the `magics` tables to keep it at ~130 KB), Vite (no UI framework). Docker uses a `rust:1-slim` stage for the WASM build and `node:22-slim` + python3 to run. Pieces: cburnett set (GPLv2+, from lichess).

Design: dark slate background `#171b22`, stone `#dcd8cc` and slate-blue `#7d8ba0` squares, one amber accent `#f0b44c`, Manrope font.

## Tests

`npm test` runs `cargo test` for `core/` (SAN/FEN, castling, checkmate, threefold, promotion, insufficient material). It then runs vitest against a test-only random-move engine in `tests/fixtures/`, covering the UCI handshake, a missing binary, a full game, losing on time, game-end rules through `Game`, and the engine host (relaying UCI, refusing files outside the engines folder). The UI was also checked in headless Chrome:
- drag and click moves, and an illegal drop snapping back
- playing as Black
- resigning
- the phone-sized layout
- adding an engine through the file picker and removing it

# Part 2: Engine vs. engine

## Built

- **Engine versions.** Layout: `engines/<engine>/<version>/<files>`.
  - Uploads always go into a version folder. The client chooses the next free `vN`.
  - An engine kept the old way (a loose file, or files directly in `engines/<engine>/`) is moved into `v1/` when its first new version is added, and its `engines.json` entries are rewritten.
  - The list groups versions under their engine, newest first, marked "latest".
  - Renaming a version changes its label (`engines.json` `name`). Removing a version deletes its folder.
- **Matches** (`server/match.ts`, the **Match** tab, `client/src/views/match.ts`).
  - Settings: engine A vs. B; 1 / 100 / 1,000 / 5,000 / 10,000 games or a custom number (1–100,000); 20 ms / 100 ms / 1 s per move, 10+0.1, or ∞; 16–200 boards at once.
  - ∞ is the time control `{kind: 'depth', depth: 16}`: no clock, the engine gets `go depth 16`. Engines with their own fixed depth ignore it. Depth 16 keeps Stockfish under ~1 s per move on one core (measured: 14 → 0.5 s, 16 → 0.8 s, 18 → 1.5 s, 20 → 2.1 s). A search counts as hung after 5 minutes.
  - Each board is a slot that plays games one after another. Boards don't own engine processes. Each engine has one **pool** (`server/pool.ts`) of `floor(cores / 2)` processes, and a game borrows an idle process for each move. At most one search runs per core, memory is bounded by the pool size, and results are accurate.
    - Why: with a process pair per board, a stress test (100 boards, Stockfish vs. Stockfish, 300 games at 20 ms, 8 GB Docker VM) used all the memory. Only 43 of 300 games ended normally (120 failed to start, 124 lost on time because the engine hung, 13 crashes).
    - The clock starts when the borrowed process gets `go` (the `started` callback in `MoveRequest`), not while the game waits for a free process.
    - A process that crashes or hangs is replaced, and that game counts as a loss for the engine. If replacement fails 3 times in a row, or the engine can't start at all, the match stops with an error instead of piling up losses.
    - The tally counts how games ended (`ends`), and the UI shows the failures (crash, time, illegal move) in red.
  - **Back to back:** "Games at once: 1" plays the games one after another on the big board (no grid). Pools then use one process per engine.
  - **PGN export** (`client/src/pgn.ts`, the PGN button in the move-list nav, shared by Play and Match), copied to the clipboard (falls back to `execCommand('copy')` when the page isn't on localhost/https): the Seven Tag Roster plus TimeControl (`base+inc`, or `-` for per-move time and ∞) and Termination (normal / time forfeit / rules infraction / abandoned / unterminated). The movetext is SAN with `[%eval …]` comments, `N...` after a comment, the end reason as a final comment, wrapped at 80 characters. Verified by importing into python-chess: no errors, all moves legal, evals read.
  - **Single game:** Games = 1 opens that game on the big board right away (engine A has White) and hides "← All boards".
  - Colors swap every game. There is no opening book (the user chose this): every game starts from the start position.
- **Grid:** one `<canvas>` per board. A board redraws only when its position changes, in one `requestAnimationFrame` pass with the device pixel ratio capped at 2. Boards always form one full rectangle: the column count divides the board count (100 → 10×10, 200 → 20×10), packed with 2–3 px gaps in one framed box, sized to fit the screen (minimum 40 px, then it scrolls).
  - A finished game tints the board in the winner's color. When the next game starts, the old result flashes.
  - Updates are batched by the server every 100 ms (`match.tick` with only the changed boards).
- **Live boards Show/Hide** (saved in localStorage). Hidden: the stage shows a big score card, and the grid stops drawing.
- **Watch one board:** clicking a mini board sends `match.watch {slot}`. The server then sends `match.game {slot, game}` (full `GameState`) on every move of that board's game, to that browser only. The big board + move list follow the slot across its games. Esc / "← All boards" sends `match.watch {slot: null}`.
- **Score:** A wins / draws / B wins, a stacked bar, A's score, and the Elo difference ± 95%, shown from 10 games on. Score `s = (W + D/2)/N`, `elo = −400·log10(1/s − 1)`, and the error comes from the per-game score variance.

## Not built yet

- Engine vs. engine as a single game on the big board (the server's `play.new` already accepts two engine ids).
- A results list per game, a PGN of the whole match, and saving match results to disk.
- Opening variety (book lines). The user doesn't want this for now.

## Smaller ideas

- Start from a custom FEN, or load PGN openings from a file.
- Per-engine UCI options editable in the UI (now only through `engines.json`).
- Adjudication rules (resign at −X for N moves, draw at |eval| < Y after move Z) to make matches shorter.
- An SPRT stop rule (H0/H1 Elo bounds) for engine testing.
- Save match results to disk so they survive a restart.
