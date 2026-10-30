# Architecture

> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md)

```
browser pane ──ws "api/sessions/<id>/io"──▶ cc /plugins/code-terminal/ proxy ──▶ backend (wsGateway → Session)
backend ──ws, no Origin──▶ $CONDUCTOR_URL/api/terminal?spec=…   (a local or provider System)
backend ──HTTP──▶ $CONDUCTOR_URL/api/projects, /api/projects/:name/location, /api/exec
```

cc is only the byte pipe: the backend owns sessions, scrollback and reattach. A terminal dies with cc; the backend survives a cc restart (cc re-adopts it).

## Backend modules (`lib/`)

`server.js` is wiring only: it builds the collaborators below and mounts them.

| Module | Responsibility |
|---|---|
| `config.js` | `PORT`, `CONDUCTOR_URL`, `PROJECTS_ROOT` → `{port, conductorUrl, dataDir}`; standalone when either var is unset |
| `requestGuard.js` | `requestRefusal`: the Origin/Host rule for upgrades and API requests |
| `securityHeaders.js` | `CSP` and `SECURITY_HEADERS`, sent on every response |
| `refusal.js` | `Refusal`: a status + `{code, error}`, cc's or the plugin's |
| `ccClient.js` | cc REST and `openTerminal`, each with a deadline and a byte cap; parses a pre-upgrade refusal body |
| `ptyProbe.js` | per-`(system, remoteId)` terminal availability |
| `shellLaunch.js` + `shell/` | integration install per System; `buildSpec` |
| `session.js` | one terminal: upstream socket, headless mirror, one client, state, backpressure |
| `sessionManager.js` | the registry: create (location → spec → open), get, list, kill, closeAll |
| `layoutStore.js` | per-project layout files, atomic writes |
| `api.js` | the REST router |
| `wsGateway.js` | the `io` upgrade: guard → lookup → attach |

`shared/layout.js` holds the layout validator and limits; the frontend imports the same file.

## Session lifecycle

- **Create:** `cc.projectLocation` → `shellLaunch.specFor` (installs on first use per System) → `cc.openTerminal`. A refusal updates the pty probe's cache and is passed to the caller; a success marks the System available.
- **Mirror:** every upstream byte goes into an `@xterm/headless` terminal (`scrollback: SCROLLBACK_LINES`) with `@xterm/addon-serialize`. The mirror's own replies to terminal queries are never read: only the attached browser answers, so the program gets one reply.
- **Attach:** resize (when the attach names a size) → wait until the mirror has parsed everything written so far → send `hello`, the serialized snapshot, then the output that arrived meanwhile, then live output.
- **States:** `running` → `exited` (cc's `exit` message) / `failed` (cc's `failed`) / `ended` (upstream closed without a message, e.g. 1006 when cc exits). An ended session stays in the registry, replayable, until `DELETE`.
- **Backpressure:**
  - Output: the upstream socket is paused while unsent bytes to the client reach `CLIENT_HIGH_WATER_BYTES`, or unparsed bytes in the mirror reach `MIRROR_HIGH_WATER_BYTES`; resumed when the client has none outstanding and the mirror is under its mark. cc then pauses the program.
  - Input: the browser socket is paused while unsent input to cc reaches `UPSTREAM_HIGH_WATER_BYTES`, resumed at zero.
  - With no client attached, output still flows into the mirror.
- **Shutdown:** SIGTERM/SIGINT closes every upstream (`closeAll`).

## Pty probe

- cc has no endpoint that reports pty support, so `ptyProbe.status(row)` opens `sh -c 'exit 0'` at 1×1 through the row's project and closes it.
- One probe per `(system, remoteId)`, deduplicated while in flight, cached for the process lifetime.
- 501 → `unavailable`, 502 → `unreachable` (both cached); any other refusal → `unknown` (not cached, logged).
- A row with `systemUnreachable` is `unreachable` without a probe.
- Real opens overwrite the cache: a 501/502 refusal sets it, a success sets `available`.

## Shell integration

- `shell/install.sh` (POSIX sh) runs on the target through `POST /api/exec`, as `sh -c <script> sh <base> <hash> <file> <content>…`:
  - `umask 077`; writes the files under `<base>/shell/<hash>/` via a temp dir + rename, with a `.complete` marker; creates `<base>/history/`;
  - prints the login shell (passwd entry, then `$SHELL`, then `/bin/sh` — cc's own rule), `$HOME`, and `<base>`.
- `<base>`: local → the data dir; elsewhere → empty, meaning `$HOME/.local/state/code-terminal` on the target.
- `<hash>`: a content hash of the integration files, so a changed file installs into a new directory.
- Installs are cached per System; a failed one is forgotten so the next open retries.
- `shell/bashrc`: login files, then `HISTFILE=$CODE_TERMINAL_HISTFILE`, `histappend`, and `history -a; history -c; history -r` prepended to `PROMPT_COMMAND`. Bash reads the history file after its init file, so the user's files cannot win.
- `shell/zsh/.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`: each sources the user's counterpart from their `ZDOTDIR` (or `$HOME`) and points `ZDOTDIR` back at the wrapper; `.zlogin` (last) pins `HISTFILE`, sets `SAVEHIST`/`HISTSIZE` when unset or 0, `setopt SHARE_HISTORY`, and restores the user's `ZDOTDIR`.

## On-disk state

```
$PROJECTS_ROOT/.code-terminal/          (mode 0700 dirs, 0600 files)
├── layouts/<project>.json              one layout tree per project
├── shell/<hash>/                       installed integration (local System)
│   ├── bashrc
│   └── zsh/.zshenv .zprofile .zshrc .zlogin
└── history/<project>                   per-project HISTFILE
$HOME/.local/state/code-terminal/       same shell/ and history/ on any other System
```

- Project names become path segments only after `validProjectName` (`lib/shellLaunch.js`): cc's name rule, never `.` or `..`.
- Sessions are memory only.

## Frontend (`frontend/src/`)

| Module | Responsibility |
|---|---|
| `App.tsx` | route (`?project=`), projects, session list poll, per-project layouts (debounced save), pane actions |
| `api.ts` | REST calls; relative URLs; JSON content type on every mutation |
| `sidebar/Sidebar.tsx`, `WorktreePicker.tsx` | project rows, availability notes, New shell, nested shells |
| `layout/tree.ts` | pure tree operations (`split`, `close`, `focusAfterClose`, `setRatio`, `updatePane`); validator from `shared/layout.js` |
| `layout/SplitView.tsx` | recursive render; divider drag via CSSOM `flex-basis` |
| `terminal/TerminalPane.tsx` | xterm lifecycle (fit + web-links addons), header, states, Restart, link tooltip |
| `terminal/socket.ts` | the attach socket; backoff reattach; asks `GET api/sessions` whether a dropped session still exists |
| `terminal/links.ts` | the link policy for web links and OSC 8 |
| `terminal/keys.ts` | Ctrl+Shift+C/V |
| `terminal/theme.ts` | host tokens → hex via a one-pixel canvas (xterm cannot parse oklch); follows theme flips |

## Tests

| Suite | Where | Run | Notes |
|---|---|---|---|
| backend | `tests/*.test.mjs` | `npm run test:server` | node:test against `tests/fakeCc.mjs` (http + ws stand-in for cc, injected as `conductorUrl`); `tests/helpers.mjs` sets Host/Origin freely |
| shell history | `tests/shell-history.test.mjs` | in the backend suite | real `bash`/`zsh` from PATH over pipes, temp HOME with hostile dotfiles; skips a shell that is absent |
| frontend | `frontend/src/**/*.test.ts(x)` | `npm run test:web` | vitest + happy-dom; xterm is mocked in `TerminalPane.test.tsx`; `palette.test.ts` pins cc's tokens |
| real cc | `tests/integration/*.test.mjs` | `RUN_REAL_CC=1 npm run test:server` | skipped otherwise; each file boots its own scratch cc |
| visual | `harness/playwright/scenarios/*.mjs` | `node harness/playwright/run.mjs [scenario…]` | needs `CC_PROJECTS_ROOT`; fails on any CSP violation, page error or dialog; screenshots in `harness/playwright/out/` |

- **Scratch cc** (`harness/scratch-cc.mjs`): `git clone --no-hardlinks` of `$CC_PROJECTS_ROOT/code-conductor`, checked out at `CC_COMMIT`, `node_modules` symlinked; started by its `scripts/run-isolated.sh` with a free port, its own root and a temp `HOME` in a sanitized environment; this worktree's tracked and unignored files copied into a fresh repo, built, adopted, enabled and started; projects `alpha` and `beta` created. `addProviderProject` registers a System launched with cc's `referenceProvider.ts` (optionally `--no-pty`). Teardown stops the plugin and kills only the cc pid whose `/proc` cwd and environment prove it is the scratch one (or, once cc is gone, the plugin process group whose cwd is the scratch copy). `KEEP_SCRATCH=1` keeps the temp dir.
- **Mutation:** `harness/mutation/` routes cover `tests/**/*.test.mjs` and `frontend/src/**/*.test.ts(x)`; the real-cc files skip there.
