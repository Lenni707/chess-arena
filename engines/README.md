Drop your UCI engines in this folder.

- Executables, `*.py` and `*.js` files here (or one folder deep) are found automatically.
- Each engine lives in `<engine>/<version>/` (e.g. `my-engine/v2/`); the app creates these when you upload.
- Inside Docker the engines run on Linux: use Linux builds (arm64 on Apple Silicon, x86-64 on Intel/AMD), or keep `npm run engine-host` running on your Mac so native macOS builds run there.
- `.engine-host-token` is the secret the engine host and the server share. It isn't an engine.
- `engines.json` (optional) sets names, arguments and UCI options:

```json
[
  { "name": "My Engine", "command": "my-engine/bin/engine", "args": [], "options": { "Hash": 64, "Threads": 1 } },
  { "name": "Script on the Mac", "command": "python3", "args": ["/engines/bot.py"], "host": true }
]
```
