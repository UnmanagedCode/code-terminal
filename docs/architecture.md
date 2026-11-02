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
| `config.js` | `PORT`, `CONDUCTOR_URL`, `CONDUCTOR_PLUGIN_DATA_DIR` → `{port, conductorUrl, dataDir}`; standalone without `CONDUCTOR_URL`; throws when `CONDUCTOR_URL` is set without an absolute data dir |
| `migrateLegacyDataDir.js` | run at boot before the store opens; moves a legacy store found in the projects root into the data dir; idempotent; refuses a non-empty data dir |
| `requestGuard.js` | `requestRefusal`: the Origin/Host rule for upgrades and API requests |
| `securityHeaders.js` | `CSP` and `SECURITY_HEADERS`, sent on every response |
| `refusal.js` | `Refusal`: a status + `{code, error}`, cc's or the plugin's |
| `ccClient.js` | cc REST and `openTerminal`, each with a deadline and a byte cap; parses a pre-upgrade refusal body |
| `ptyProbe.js` | per-`(system, remoteId)` terminal availability |
| `shellLaunch.js` + `shell/` | integration install per System; `buildSpec` |
| `session.js` | one terminal: upstream socket, headless mirror, one client, state, backpressure |
| `sessionManager.js` | the registry: create (location → spec → open), get, list, kill, killCheckout, closeAll |
| `layoutStore.js` | per-checkout layout files (get, put, remove), atomic writes (a uniquely named temp file renamed over the old one) |
| `api.js` | the REST router |
| `wsGateway.js` | the `io` upgrade: guard → lookup → attach |

`shared/layout.js` holds the layout validator and limits, and `shared/terminal.js` the terminal limits (`SCROLLBACK_LINES`, `TITLE_MAX_CHARS`); the frontend imports the same files.

## Session lifecycle

- **Number:** each session gets the next per-project `ordinal` from the manager.
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
  - `umask 077`; writes the files under `<base>/shell/<hash>/` via a temp dir + rename, with a `.complete` marker; an installer that finds the directory already there (another won the race) removes its temp dir; creates `<base>/history/`;
  - prints the login shell (passwd entry, then `$SHELL`, then `/bin/sh` — cc's own rule), `$HOME`, and `<base>`.
- `<base>`: local → the data dir; elsewhere → empty, meaning `$HOME/.local/state/code-terminal` on the target.
- `<hash>`: a content hash of the integration files, so a changed file installs into a new directory.
- Installs are cached per System; a failed one is forgotten so the next open retries.
- `shell/bashrc`: login files, then `HISTFILE=$CODE_TERMINAL_HISTFILE`, `histappend`, and `history -a; history -c; history -r` prepended to `PROMPT_COMMAND`. Bash reads the history file after its init file, so the user's files cannot win.
- `shell/zsh/.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`: each sources the user's counterpart from their `ZDOTDIR` (or `$HOME`) and points `ZDOTDIR` back at the wrapper; `.zlogin` (last) pins `HISTFILE`, sets `SAVEHIST`/`HISTSIZE` when unset or 0, `setopt SHARE_HISTORY`, and restores the user's `ZDOTDIR`.

## On-disk state

```
$CONDUCTOR_PLUGIN_DATA_DIR/             (mode 0700 dirs, 0600 files)
├── layouts/<project>/main.json         the main checkout's layout tree
│   └── worktrees/<worktree>.json       one per worktree
├── shell/<hash>/                       installed integration (local System)
│   ├── bashrc
│   └── zsh/.zshenv .zprofile .zshrc .zlogin
└── history/<project>                   per-project HISTFILE
$HOME/.local/state/code-terminal/       same shell/ and history/ on any other System
```

- The plugin creates the data dir (0700): the boot migration creates its missing parent chain (`plugins/data`) when it moves a legacy store in; otherwise the first layout write or shell install creates it. cc never touches it.
- Project and worktree names become path segments only after `validProjectName` (`lib/shellLaunch.js`): cc's name rule, never `.` or `..`.
- Sessions are memory only.

## Frontend (`frontend/src/`)

| Module | Responsibility |
|---|---|
| `App.tsx` | wiring: projects, tabs, pane and close-tab actions, picker and confirm state, notice |
| `checkout.ts` | `Checkout`, key and label, presence in cc's listing, availability note, running count |
| `route.ts`, `storage.ts` | `?project=&worktree=` read, push (`writeRoute`) and in-place replace (`replaceRoute`); `localStorage` under the `code-terminal:` prefix |
| `menu/target.ts` | `readMenuTarget` (the `ccProject`/`ccWorktree` params) and `resolveMenuTarget` (checks them against a listing) |
| `menu/useMenuTarget.ts` | captures the params at first render (before `useTabs`'s mount effect rewrites the URL), re-reads them on `popstate`, validates against a fresh listing, latest target wins; `App` supplies `pick` as `open` |
| `tabs/tabs.ts`, `useTabs.ts` | the tab reducer and its persistence; restore from storage, then the URL; route sync and popstate |
| `tabs/TabBar.tsx`, `TabMenu.tsx` | the tab strip and its `role="menu"` popup |
| `tabs/useTabShortcuts.ts` | Ctrl/⌘+digit on `window` in the capture phase, swallowing the key: xterm turns Ctrl+2…8 into control bytes and stops the event, so a bubbling listener never sees it inside a terminal |
| `picker/CheckoutPicker.tsx` | grouping, filter, availability, live counts |
| `dialog/Modal.tsx`, `ConfirmDialog.tsx` | native `<dialog>` wrapper; the destructive confirm |
| `layout/useLayouts.ts` | layouts keyed by checkout: debounced save, flushed on `pagehide` and unmount; `hold`/`release`/`drop` around a close; a change for a checkout without a tab is ignored |
| `sessions/useSessions.ts` | the session poll and the set of sessions this page killed |
| `api.ts` | REST calls; relative URLs; JSON content type on every mutation; layout saves and kills use `keepalive` so they outlive an unload |
| `layout/tree.ts` | pure tree operations (`split`, `close`, `focusAfterClose`, `setRatio`, `updatePane`); validator from `shared/layout.js` |
| `layout/SplitView.tsx` | recursive render; divider drag via CSSOM `flex-basis` |
| `terminal/TerminalPane.tsx` | xterm lifecycle (fit + web-links addons), header, states, Restart, link tooltip; `onData` runs through the pane's `Modifiers.apply` before `sendInput`; bar keys enter through `term.input` |
| `terminal/socket.ts` | the attach socket; backoff reattach; asks `GET api/sessions` whether a dropped session still exists |
| `terminal/links.ts` | the link policy for web links and OSC 8 |
| `terminal/keys.ts` | Ctrl+Shift+C/V |
| `terminal/extraKeys.ts` | the bar's catalog (`EXTRA_KEYS`), `keySequence`, pure `applyModifiers`, the `Modifiers` state machine (injectable clock) |
| `terminal/softKeyboard.ts` | `disableTextAssist` on xterm's helper textarea |
| `terminal/capsPlaceholder.ts` | `attachCapsPlaceholder`: keeps `PLACEHOLDER` in the helper textarea on touch; one re-armed `setTimeout(0)` reseed, listeners in xterm's phases, DEL de-duplication; attached from `TerminalPane` by `[touch, opened]` |
| `terminal/useTouchDevice.ts` | `(hover: none)` via `useSyncExternalStore` |
| `terminal/ExtraKeys.tsx` | the bar; `pointerdown` is prevented so focus stays, the action fires on `click` |
| `terminal/theme.ts` | host tokens → hex via a one-pixel canvas (xterm cannot parse oklch); follows theme flips |

## Tests

| Suite | Where | Run | Notes |
|---|---|---|---|
| backend | `tests/*.test.mjs` | `npm run test:server` | node:test against `tests/fakeCc.mjs` (http + ws stand-in for cc, injected as `conductorUrl`); `tests/helpers.mjs` sets Host/Origin freely |
| shell history | `tests/shell-history.test.mjs` | in the backend suite | real `bash`/`zsh` from PATH over pipes, temp HOME with hostile dotfiles; skips a shell that is absent |
| frontend | `frontend/src/**/*.test.ts(x)` | `npm run test:web` | vitest + happy-dom; xterm is mocked in `TerminalPane.test.tsx`; `palette.test.ts` pins cc's tokens |
| config, boot, migration | `tests/config.test.mjs`, `tests/migrate-legacy-data-dir.test.mjs`, `tests/boot.test.mjs` | in the backend suite | `loadConfig` rules, the boot-time store move, and `node server.js` exit/listen behaviour in fixture dirs |
| real cc | `tests/integration/*.test.mjs` | `RUN_REAL_CC=1 npm run test:server` | skipped otherwise; each file boots its own scratch cc |
| visual | `harness/playwright/scenarios/*.mjs` (`split`, `reload`, `history`, `untrusted-output`, `tabs`, `menu`, `mobile`) | `node harness/playwright/run.mjs [scenario…]` | needs `CC_PROJECTS_ROOT`; a scenario may export `contextOptions`, merged into `newContext` (`mobile` uses a 360×740 touch viewport); fails on any CSP violation, page error or dialog; screenshots in `harness/playwright/out/` |

- **Phone test page:** `harness/mobile-input/` (own `vite.config.ts`, output `dist/` ignored) is built and published by hand to try soft-keyboard changes on a device; it is not run in CI. `capsPlaceholder.test.ts` drives the real `@xterm/xterm` under happy-dom (fake timers, Chrome-Android-shaped event sequences).
- **Scratch cc** (`harness/scratch-cc.mjs`): `git clone --no-hardlinks` of `$CC_PROJECTS_ROOT/code-conductor`, checked out at `CC_COMMIT` (which must understand every manifest key the plugin uses: cc rejects unknown top-level keys, and must pass `CONDUCTOR_PLUGIN_DATA_DIR`; the scratch's value is `scratch.dataDir`), `node_modules` symlinked; started by its `scripts/run-isolated.sh` with a free port, its own root and a temp `HOME` in a sanitized environment; this worktree's tracked and unignored files copied into a fresh repo, built, adopted, enabled and started; projects `alpha` and `beta` created. `createWorktree` makes a worktree through cc's MCP `create_worktree`. `addProviderProject` registers a System launched with cc's `referenceProvider.ts` (optionally `--no-pty`). Teardown stops the plugin and kills only the cc pid whose `/proc` cwd and environment prove it is the scratch one (or, once cc is gone, the plugin process group whose cwd is the scratch copy). `KEEP_SCRATCH=1` keeps the temp dir.
- **Manifest:** `tests/manifest.test.mjs` pins `menuItems`; the real-cc test `tests/integration/local.test.mjs` has cc's own validator accept the manifest. The `menu` scenario clicks cc's real row menus and checks the frame is not reloaded.
- **Mutation:** `harness/mutation/` routes cover `tests/**/*.test.mjs` and `frontend/src/**/*.test.ts(x)`; the real-cc files skip there.
