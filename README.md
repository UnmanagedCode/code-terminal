# Code Terminal

A [code-conductor](https://github.com/UnmanagedCode/code-conductor) (cc) plugin that gives in-browser terminals grouped by project.

## What it is for

- Terminals inside cc's plugin pane, one group per project, with split panes.
- Per-project shell history.
- Sessions held by the plugin backend, so a browser reload reattaches to running shells.

**Current state: skeleton.** The plugin installs, starts, answers its health route and shows a placeholder page ("Terminal" nav entry). No terminal features exist yet.

## Technical overview

- **Stack:** Node (ESM, `>=22.12`) + Express backend; Vite + React + TypeScript frontend.
- **Manifest:** `conductor.plugin.json` (`id` `code-terminal`, `pluginApi` 1, health path `/api/health`).
- **Serving:** `server.js` listens on `127.0.0.1:$PORT` (default 4000), serves an allowlist of files from `frontend/dist`, and sets a strict CSP. Unbuilt UI → `/` answers 503, health stays up.
- **Host contract:** `index.html` loads `/pluginBridge.js` and `/pluginTheme.css`; all other URLs are relative; content width uses `var(--cc-session-width, 48rem)`; `frontend/src/cc-theme-fallback.css` keeps the page legible standalone.

```
conductor.plugin.json   plugin manifest
server.js               backend (health route + static UI)
tests/                  backend tests (node --test)
frontend/               Vite app; src/*.test.tsx are Vitest tests
harness/mutation/       mutation-verification config (see its README)
harness/playwright/     screenshot harness over the shared code-playwright
.code-conductor/        post-worktree-create hook (links the out-of-tree .wiki)
```

## Commands

| Command | Does |
|---|---|
| `npm install` | installs deps and builds `frontend/dist` (the `prepare` script) |
| `npm run prepare` | rebuild the UI only |
| `npm start` | run the backend (`PORT=<port>` to override) |
| `npm run dev` | Vite dev server, proxying `/api` to the backend |
| `npm run typecheck` | `tsc -p frontend` |
| `npm test` | backend (`node --test "tests/**/*.test.mjs"`) then frontend (`vitest run --config frontend/vitest.config.ts`) |

## Verification harnesses

Both need `CC_PROJECTS_ROOT` exported when run outside a cc-spawned shell.

- **Mutation:** `node "$CC_PROJECTS_ROOT/.plugins/code-mutant/mutate.mjs" baseline` — see [harness/mutation/README.md](harness/mutation/README.md).
- **Visual:** `node harness/playwright/screenshot.mjs [out.png]` boots the backend and saves a screenshot (default `harness/playwright/out/home.png`, git-ignored).

## Known limitations

- No terminal, split-pane or history functionality yet; the WebSocket endpoint it will use in cc does not exist yet.
