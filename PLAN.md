# Chess Arena: full plan

This one file has the whole project: what the app is, what's built, how it works, and what's planned.

## The idea

A clean, modern chess GUI for your own UCI engines:
- moves work like chess.com (drag or click)
- adding an engine is as easy as picking its file
- no extra menus

The full vision also covers engines playing each other: matches with many games, a clear view of who won, and a satisfying grid of 100+ live boards. Part 1 (play against one engine) is built. Part 2 (engine vs. engine) is planned below.

# Part 1: Play against an engine (built)

## Running it

```sh
docker compose up --build -d     # then open http://localhost:3000
npm install && npm run dev       # without Docker, then open http://localhost:5173
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
  - **×** removes an engine.
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
- **Docker runs Linux.** Use Linux builds of your engines (arm64 on Apple Silicon) or script engines (Python 3 and Node are in the image). To use native macOS builds, run with `npm run dev` instead.
- No engines are bundled.

## How games are run

- The server owns the game and checks every move with chess.js. A browser move that isn't legal is rejected, and the board resyncs.
- Engines get `position startpos moves …` and `go wtime btime winc binc`, or `go movetime` when there is no clock.
- How a game ends:
  - checkmate, stalemate, threefold repetition, the 50-move rule, insufficient material
  - running out of time, except it's a draw if the opponent has only a king
  - resignation
  - an engine crash, hang or illegal move, which loses for that engine
- The eval bar uses the engine's last `info score`, converted to White's point of view.

## Architecture

| Part | File |
| --- | --- |
| UCI process wrapper: handshake, `go` with hard time limit, score parsing, crash and wrong-OS detection | `server/uci.ts` |
| Engine discovery, `engines.json`, upload and remove | `server/engines.ts` |
| Game, clocks, human and engine players, game-end rules | `server/game.ts` |
| HTTP (static files, `POST /api/engines/upload`) + WebSocket `/ws` | `server/index.ts` |
| Message types shared by client and server | `shared/protocol.ts` |
| Interactive board (drag, click, promotion, arrows, animation) | `client/src/board/Board.ts` |
| Board + eval bar + clocks + move list | `client/src/views/GameView.ts` |
| Setup panel / engines panel | `client/src/views/play.ts`, `client/src/views/engines.ts` |

Stack: Node 22 + TypeScript, `ws`, `chess.js`, Vite (no UI framework), Docker (`node:22-slim` + python3). Pieces: cburnett set (GPLv2+, from lichess).

Design: dark slate background `#171b22`, stone `#dcd8cc` and slate-blue `#7d8ba0` squares, one amber accent `#f0b44c`, Manrope font.

## Tests

`npm test` runs vitest against a test-only random-move engine in `tests/fixtures/`, covering the UCI handshake, a missing binary, a full game, and losing on time. The UI was also checked in headless Chrome:
- drag and click moves, and an illegal drop snapping back
- playing as Black
- resigning
- the phone-sized layout
- adding an engine through the file picker and removing it

# Part 2: Engine vs. engine (planned)

Commit `fcc4985` contains a working, tested server-side match runner (`server/match.ts`) and opening book (`server/openings.ts`). Restore them with:

```sh
git checkout fcc4985 -- server/match.ts server/openings.ts
```

## 1. Engine vs. engine (single game)

- Let either side of a game be an engine, so two engines can play one game while you watch.
- The server already supports this: `play.new` takes `white` and `black`, each `'human'` or an engine id. The UI only needs a second engine picker in place of "You play".
- "Resign" turns into "Stop" when no human is playing (the server already handles this case).

## 2. Matches: N games between two engines

Settings:
- engine A, engine B
- number of games (quick picks: 10, 50, 100, 250, 500)
- time control, as fixed time per move (50 ms, 200 ms, 1 s) or a clock (1+0.1, 10+0.1, 60+0.6)
- games at once, defaulting to the number of CPU cores

Rules:
- **Colors swap every game.** Game 2k has A as White, game 2k+1 has B as White.
- **Openings vary.** Each pair of games starts from one of ~50 balanced 6-ply lines, with colors swapped. Without this, two deterministic engines replay the same game every time. Once the book runs out, add 2 random quiet plies that don't hang a piece.
- **Engine processes are reused.** Each worker slot keeps one process per engine and sends `stop` + `ucinewgame` + `isready` between games. A dead or hung engine is restarted, and the game it failed counts as a loss for it.
- **How games end:** checkmate, stalemate, threefold repetition, 50-move rule, insufficient material, flag (with a small over-use margin), illegal move, crash. All of these already exist in `server/game.ts`.

Protocol (removed from `shared/protocol.ts`, restore together):
- client → server: `match.start {engineA, engineB, games, tc, concurrency}` and `match.stop`
- server → client: `match {summary}` once, then `match.tick {boards, tally, running, reasons}` with the changed boards batched every 100 ms

## 3. Showing who won

- A tally across the top: engine A's win count on the left in amber `#f0b44c`, draws in the middle in grey, engine B's wins on the right in blue `#7aa7f5`, all as large tabular numbers.
- Below it, a stacked bar (A | draws | B) that grows as games finish.
- A stats line showing:
  - games done out of the total
  - A's score in %
  - **Elo difference ± 95% error**, where score `s = (W + D/2)/N`, `elo = −400·log10(1/s − 1)`, and the error comes from the per-game score variance
- When the match finishes, the leader's number pulses once.
- A results list with one row per game: number, White vs Black (in engine colors), result, reason. Clicking a row opens that game.
- Download the match as PGN (`/api/match.pgn`).

## 4. The 100+ board grid

- Every game in the match appears as a live mini board in a responsive grid, with a size slider from 64 to 260 px.
- Boards are drawn on `<canvas>`, not in the DOM, so 100–500 boards stay smooth. Each one redraws only when its position changes, and the moved piece slides over 140 ms in one shared `requestAnimationFrame` loop.
- **Queued games** are dimmed and grey. **Playing** games show normally with a last-move highlight. **Finished** games fade to the winner's color (amber or blue, dark grey for draws), and the result (`1–0`, `0–1`, `½`) pops in.
- Clicking a board opens a viewer that follows that game live, with move list, arrow-key navigation and flip.
- Performance notes:
  - batch updates on the server (one message per 100 ms)
  - cap the canvas device pixel ratio at 2
  - skip animations when the tab is hidden

## 5. Smaller ideas

- Start from a custom FEN, or load PGN openings from a file.
- Per-engine UCI options editable in the UI (now only through `engines.json`).
- Adjudication rules (resign at −X for N moves, draw at |eval| < Y after move Z) to make matches shorter.
- An SPRT stop rule (H0/H1 Elo bounds) for engine testing.
- Save match results to disk so they survive a restart.
