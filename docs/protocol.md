# Protocol

> See also: [README](../README.md) · [features](features.md) · [architecture](architecture.md)

The plugin backend's own surface (REST + one WebSocket), the rules every request passes, and what the backend sends code-conductor (cc).

## Request guard

`requestRefusal` (`lib/requestGuard.js`) runs on every WebSocket upgrade and every `/api/*` request except `GET /api/health`.

| Rule | Applies to | Refusal |
|---|---|---|
| `Origin` present | upgrades; `POST`/`PUT`/`DELETE` | 403 |
| `Origin` parses to an `http:`/`https:` URL whose `.origin` equals the header exactly (no path, no userinfo, not `null`) | whenever `Origin` is present | 403 |
| `Host` parses as a bare `host[:port]` under Origin's scheme (`http:` when there is no Origin): no userinfo, path, query or fragment | always | 403 |
| `Host` equals `Origin` by host and port (lowercased, default port dropped, scheme ignored — `https://pub` matches Host `pub`) | whenever `Origin` is present | 403 |
| `Host`'s port (default port when absent) is not the backend's own listen port | always | 403 |
| `Content-Type` is `application/json` (checked on the header, body or not) | `POST`/`PUT`/`DELETE` | 415 |

- Behind cc's `/plugins/code-terminal/` proxy and every code-hub mode, `Host` and `Origin` arrive unchanged, so `Host` names the proxy's port. Only a direct dial or a DNS-rebinding dial names the backend's port.
- An upgrade refusal is a raw `403` (or `404`) with the CSP and `nosniff` headers and no body, before any WebSocket handshake.
- HTTP refusals are JSON: `{code: 'REQUEST_REFUSED' | 'UNSUPPORTED_MEDIA_TYPE', error}`.
- **Standalone** (no `CONDUCTOR_URL` or no `PROJECTS_ROOT`): every `/api/*` route but health answers `503 {code: 'HOST_UNAVAILABLE'}` before the guard runs.

## REST

All under the plugin root (`/plugins/code-terminal/` inside cc). Bodies are JSON; errors are `{code, error}`.

| Method + path | Body | Success | Refusals |
|---|---|---|---|
| `GET /api/health` | — | `200 {ok: true}` | — |
| `GET /api/projects` | — | `200 {projects: [{name, path, system, remoteId, worktrees: [{name, path, branch}], terminal}]}` | cc's refusal passed through |
| `GET /api/sessions` | — | `200 {sessions: [{id, project, worktree, state, title}]}` | — |
| `POST /api/sessions` | `{project, worktree, cols, rows}` | `201 {id}` | `400 INVALID_ARGUMENT`; `SHELL_SETUP_FAILED`; cc's terminal refusals with cc's status, code and error |
| `DELETE /api/sessions/:id` | — | `204` | `404 SESSION_UNKNOWN` |
| `GET /api/layouts/:project` | — | `200 {tree}` (`null` = none saved) | `400 INVALID_ARGUMENT` (unusable name) |
| `PUT /api/layouts/:project` | `{tree}` | `204` | `400 INVALID_ARGUMENT`, `400 INVALID_LAYOUT`, `413 LAYOUT_TOO_LARGE` |

- `projects` lists cc's `GET /api/projects` rows minus `degraded` ones; `worktrees[].name` is cc's `worktreeName`.
- `terminal` is the pty probe's verdict for the row's `(system, remoteId)` ([architecture](architecture.md#pty-probe)):

| `state` | Fields | Meaning |
|---|---|---|
| `available` | — | a terminal opened there |
| `unavailable` | `code`, `reason` | cc refused with 501 (`SYSTEM_NO_PTY`, `PTY_UNAVAILABLE`, …); `reason` is cc's own text, naming the provider |
| `unreachable` | `code`, `reason` | cc refused with 502, or the row carries cc's `systemUnreachable` (then `code` is `null`) |
| `unknown` | `code`, `reason` | any other refusal; not cached |

- `POST /api/sessions` validation: `project` matches cc's project-name rule (`validProjectName`, `lib/shellLaunch.js`); `worktree` is a non-empty string or `null` (main checkout); `cols`/`rows` integers in `1..PTY_DIM_MAX` (`lib/session.js`).
- `state` is one of `{kind: 'running'}`, `{kind: 'exited', code, signal}`, `{kind: 'failed', code, error}`, `{kind: 'ended'}`.
- `title` is the program's last OSC 0/2 title, capped at `TITLE_MAX_CHARS` (`lib/session.js`).
- The plugin's own refusals around cc:

| Status | `code` | When |
|---|---|---|
| 502 | `HOST_UNREACHABLE` | cc did not answer at all |
| 504 | `HOST_TIMEOUT` | cc did not answer a REST call, or did not open a terminal, before the deadline (`lib/ccClient.js`) |
| 502 | `HOST_BAD_RESPONSE` | cc's answer was not JSON |
| cc's or 502 | `SHELL_SETUP_FAILED` | the shell-integration install on the target failed; `error` carries the installer's stderr |

### Layouts

`tree` is `null` or a node; the shape rules are `validateLayout` (`shared/layout.js`), shared by backend and frontend.

| Node | Keys (exactly) | Rules |
|---|---|---|
| pane | `kind: 'pane'`, `id`, `sessionId`, `worktree` | `id` 1–64 of `[A-Za-z0-9_-]`, unique in the tree; `sessionId` a UUID or `null`; `worktree` a non-empty name or `null` |
| split | `kind: 'split'`, `dir`, `ratio`, `a`, `b` | `dir` `row` (side by side) or `col` (stacked); `ratio` in `RATIO_MIN..RATIO_MAX`; `a`, `b` nodes |

- The serialized tree is capped at `LAYOUT_MAX_BYTES`; validation is iterative, so depth is bounded only by that cap.

## Session I/O — `GET /api/sessions/:id/io?cols=N&rows=N` (WebSocket)

- Order: request guard → path match → session lookup (unknown id → raw `404` before the upgrade) → attach.
- `cols`/`rows` (optional) resize the session on attach when valid.
- At most one client per session. A new attach sends the previous client `{type: 'detached'}` and closes it with `4000`.
- The browser socket's largest message is `BROWSER_MAX_PAYLOAD_BYTES` (`lib/wsGateway.js`).

**Backend → browser**

| Message | When |
|---|---|
| text `{type: 'hello', state, title, scrollback}` | first, on attach; the client resets its terminal |
| binary | the serialized screen and scrollback (in chunks), then live output |
| text `{type: 'state', state}` | the session's state changed (exit, failure, end) |
| text `{type: 'detached'}` | another client attached |

**Browser → backend**

| Message | Handling |
|---|---|
| binary | input bytes; split into messages of at most `UPSTREAM_MAX_MESSAGE_BYTES` before cc; dropped once the session is not running |
| text `{type: 'resize', cols, rows}` | exactly these keys, integers in `1..PTY_DIM_MAX`; resizes mirror and program |
| any other text | dropped and logged, never forwarded (an invalid resize would make cc kill the program) |

| Close code | Meaning |
|---|---|
| `4000` (`CLOSE_DETACHED`) | another client attached |
| `4001` (`CLOSE_KILLED`) | the session was deleted |

- Nothing is dropped: a client whose unsent output passes `CLIENT_HIGH_WATER_BYTES` pauses cc's terminal until it drains; input backed up toward cc pauses the browser socket.

## What the backend sends cc

- **Terminal:** `GET $CONDUCTOR_URL/api/terminal?spec=…`, dialled with **no `Origin`** (cc refuses any). The spec keys are exactly `SPEC_KEYS` and its env names exactly `SPEC_ENV_KEYS` (`lib/shellLaunch.js`): paths and names, never secrets, since the request line may be logged.

| Shell | `argv` | `env` |
|---|---|---|
| bash | `[shell, '--init-file', <dir>/bashrc, '-i']` | `HISTFILE`, `CODE_TERMINAL_HISTFILE`, `COLORTERM` |
| zsh | `[shell, '-l']` | the above + `ZDOTDIR=<dir>/zsh` |
| other | absent (cc's default login shell) | `HISTFILE`, `CODE_TERMINAL_HISTFILE`, `COLORTERM` |

  `term` is `xterm-256color`; `COLORTERM` is `truecolor`.
- **Pty probe:** `{project, argv: ['sh', '-c', 'exit 0'], cols: 1, rows: 1}`, closed as soon as it opens.
- **Shell setup:** one `POST $CONDUCTOR_URL/api/exec` per `(system, remoteId)`: `{project, argv: ['sh', '-c', <shell/install.sh>, 'sh', <base>, <hash>, <file>, <content>, …], timeoutMs}`. The installer rides argv (no stdin staging) and prints `shell=`, `home=`, `base=` lines.
- **Placement:** `GET $CONDUCTOR_URL/api/projects/:name/location` before each open (no git work); `GET $CONDUCTOR_URL/api/projects` for the listing.
- cc's terminal closing with **1006** and no message (cc exited) → `ended`; `exit` → `exited`; `failed` → `failed`.

## CSP

`CSP` (`lib/securityHeaders.js`) plus `X-Content-Type-Options: nosniff` on every response: static files, 404, 503, errors, API refusals, upgrade refusals, and requests node's parser rejects (`clientError`).

- `style-src-elem 'self' 'unsafe-inline'` and `style-src-attr 'unsafe-inline'` are xterm.js's: it renders through a `<style>` element and style attributes, with no nonce hook. The app never emits a style from terminal or cc content.
- `script-src 'self'` only; `form-action 'none'`; `frame-ancestors 'self'`.
