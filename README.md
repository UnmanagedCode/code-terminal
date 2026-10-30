# Code Terminal

A [code-conductor](https://github.com/UnmanagedCode/code-conductor) (cc) plugin: in-browser terminals grouped by project, on the System each project lives on — this machine or a remote one.

## What it does

- A sidebar of cc's projects; **+** opens a shell in the project's main checkout or a chosen worktree.
- Split panes (side by side, stacked), draggable dividers, a layout saved per project.
- xterm.js terminals with 256-colour and truecolor, full-screen programs, safe link handling and clipboard keys.
- Per-project shell history for bash and zsh, shared live between a project's shells.
- Shells live in the plugin backend: a browser reload reattaches and replays screen and scrollback.
- Projects on a System without terminal support are shown disabled with cc's reason.

Details: [docs/features.md](docs/features.md).

## Technical overview

- **Stack:** Node (ESM, `>=22.12`) + Express + `ws` + `@xterm/headless` backend; Vite + React + TypeScript + `@xterm/xterm` frontend.
- **Manifest:** `conductor.plugin.json` (`id` `code-terminal`, `pluginApi` 1, health path `/api/health`).
- **Terminals:** the backend opens each one through cc's `GET /api/terminal` WebSocket and keeps a headless mirror of it for reattach; installs its shell integration through cc's `POST /api/exec`.
- **Serving:** `server.js` listens on `127.0.0.1:$PORT` (default 4000), serves an allowlist of files from `frontend/dist`, and sends a CSP and `nosniff` on every response.
- **Security:** every upgrade and API request passes an Origin/Host guard that refuses cross-site requests and any request naming the backend's own port (a direct dial, or DNS rebinding onto that port); mutations need a JSON content type. See [docs/protocol.md](docs/protocol.md#request-guard).
- **Data:** `$PROJECTS_ROOT/.code-terminal/` (layouts, history, shell integration); on other Systems `$HOME/.local/state/code-terminal/`.
- **Host contract:** `index.html` loads `/pluginBridge.js` and `/pluginTheme.css`; all other URLs are relative; route state in `?project=`; width capped by `var(--cc-session-width, none)`; `frontend/src/cc-theme-fallback.css` keeps the page legible standalone.

```
conductor.plugin.json   plugin manifest
server.js               backend wiring
lib/                    backend modules (guard, cc client, sessions, probe, shell launch, layouts, api, ws)
shell/                  shell integration installed on each System (install.sh, bashrc, zsh/)
shared/                 layout validator and terminal limits shared by backend and frontend
frontend/               Vite app; src/**/*.test.ts(x) are Vitest tests
tests/                  backend tests (node --test) with a fake cc; tests/integration/ need a real cc
harness/scratch-cc.mjs  throwaway isolated cc for real-cc tests and Playwright
harness/mutation/       mutation-verification config (see its README)
harness/playwright/     visual scenarios over the shared code-playwright
docs/                   features, protocol, architecture
.code-conductor/        post-worktree-create hook (links the out-of-tree .wiki)
```

Internals: [docs/architecture.md](docs/architecture.md).

## Commands

| Command | Does |
|---|---|
| `npm install` | installs deps and builds `frontend/dist` (the `prepare` script) |
| `npm run prepare` | rebuild the UI only |
| `npm start` | run the backend (`PORT=<port>`; without `CONDUCTOR_URL` and `PROJECTS_ROOT` it runs standalone) |
| `npm run dev` | Vite dev server, proxying `/api` (WebSockets included) to the backend |
| `npm run typecheck` | `tsc -p frontend` |
| `npm test` | backend (`node --test "tests/**/*.test.mjs"`) then frontend (`vitest run --config frontend/vitest.config.ts`) |
| `RUN_REAL_CC=1 npm run test:server` | also runs `tests/integration/` against scratch ccs (needs `CC_PROJECTS_ROOT`) |
| `node harness/playwright/run.mjs [split\|reload\|history\|untrusted-output]` | visual scenarios against a scratch cc; screenshots in `harness/playwright/out/` |
| `node harness/playwright/screenshot.mjs [out.png]` | screenshot of the standalone page |

## Verification harnesses

All need `CC_PROJECTS_ROOT` exported when run outside a cc-spawned shell.

- **Mutation:** `node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" baseline` — see [harness/mutation/README.md](harness/mutation/README.md).
- **Real cc / visual:** both use `harness/scratch-cc.mjs`, which never touches the user's own cc — see [docs/architecture.md](docs/architecture.md#tests).

## Known limitations

- Shells do not survive a restart of the plugin backend, of cc, or of a remote System's provider: their panes show `ended` with **Restart**.
- bash runs as an interactive shell that loads the login files itself, not as `bash -l` (a login bash never reads an init file, which per-project history needs).
- The history guarantees cover bash and zsh only; another login shell gets `HISTFILE` and may ignore it.
- The 16 standard ANSI colours are xterm's defaults, which can be hard to read on the light theme.
- One browser client per shell: attaching in a second tab detaches the first.
- A proxy in front of cc whose public port equals the backend's listen port (e.g. a code-hub LAN relay) is refused by the request guard.
- DNS rebinding onto **cc's** port is not stopped: such a page reaches the plugin through cc's proxy exactly as a visit to cc does. The gap is inherited from cc, whose API has no authentication either.
