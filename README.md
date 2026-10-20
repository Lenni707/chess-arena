# Chess Arena

A clean chess GUI for playing against your own UCI engines. You can move pieces by dragging or by clicking, as on chess.com.

![](docs/screenshot.png)

## Run it

```sh
docker compose up --build -d
open http://localhost:3000
```

Without Docker (Node 22+): `npm install`, then `npm run dev` and open http://localhost:5173.

## Add your engines

Put your UCI engines in the `engines/` folder. They're picked up on start, or when you click **Rescan engines folder**. You can also add one by path in the **Engines** section.

- Executables, `*.py` and `*.js` files (top level or one folder deep) are found automatically. The engine runs with its own folder as the working directory, so NNUE files next to it load.
- **Docker runs Linux.** A macOS or Windows binary won't run in the container, and the engines list says so. Use a Linux build (arm64 on Apple Silicon), or run with `npm run dev` to use native macOS builds.
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
npm run dev        # server (tsx watch) + Vite client
npm test           # vitest: UCI wrapper and game rules against a test-only random engine
npm run typecheck
```

Engine-vs-engine matches and the 100+ board grid are planned in [ROADMAP.md](ROADMAP.md).

Piece set: cburnett by Colin M.L. Burnett (GPLv2+), from lichess.
