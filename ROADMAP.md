# Roadmap: engine vs. engine

The app currently does one thing: you play against one UCI engine. This file describes the larger features that were planned and then set aside, so they can be built later.

Commit `fcc4985` contains a working, tested server-side version of the match runner (`server/match.ts`) and the opening book (`server/openings.ts`). Restore them from there instead of starting over:

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
