Drop your UCI engines in this folder.

- Executables, `*.py` and `*.js` files here (or one folder deep) are found automatically.
- Inside Docker the engines run on Linux: use Linux builds (arm64 on Apple Silicon, x86-64 on Intel/AMD).
- `engines.json` (optional) sets names, arguments and UCI options:

```json
[
  { "name": "My Engine", "command": "my-engine/bin/engine", "args": [], "options": { "Hash": 64, "Threads": 1 } }
]
```
