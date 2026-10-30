# Features

> See also: [README](../README.md) · [protocol](protocol.md) · [architecture](architecture.md)

## Layout of the page

- **Sidebar** — every cc project. Per project:
  - its name (selects it; the route is `?project=<name>`);
  - **+** (`New shell in <project>`): opens a shell and puts it beside the focused pane, or as the only pane;
  - a **worktree picker** (only when the project has worktrees): main checkout by default, else one of cc's worktrees; the next **+** opens there;
  - a note when terminals cannot open there: cc's own reason (which names the provider) for a System without a pty — **+** is disabled; "System unreachable: …" for a System cc cannot reach — **+** stays enabled, so the user can retry;
  - its shells, nested, each labelled `shell N` (its number within the project, never reused) followed by the program's title, or else its worktree (`main` for the main checkout), and its state when not running; clicking one focuses its pane (a shell no pane shows gets one).
- **Workspace** — the selected project's split layout. Width capped by cc's session width (`--cc-session-width`).
- Layouts persist per project on the backend, so the arrangement survives a reload or another browser. A change still waiting to be saved (a closed pane, a dragged divider) is sent when the page is hidden or reloaded.

## Panes

- Header: the program's title (as text), a worktree badge (`main` for the main checkout), and three buttons: **Split side by side**, **Split stacked**, **Close shell**.
- A split opens a new shell in the same worktree. **Close** kills the shell; its sibling takes the space and focus moves there.
- Dividers drag with the pointer, or move with the arrow keys when focused; ratios are clamped so no pane vanishes.
- The terminal's size follows the pane: every resize reaches the program (`stty size` matches the pane).

## Session states

| Shown | Meaning | Action |
|---|---|---|
| (nothing) | running | — |
| `reconnecting…` | the socket dropped; the backend still has the shell | reattaches by itself |
| `this shell is open in another window` | another tab attached | **Reattach here** |
| `exited (code N)` / `exited (signal SIG…)` | the program ended | **Restart** |
| `failed: <error>` | cc lost the terminal (e.g. its provider died) | **Restart** |
| `ended` | the shell is gone: cc or the plugin restarted, or the session was killed | **Restart** |

- **Restart** opens a new shell in the same project and worktree, in the same pane.
- **Reload** keeps shells: each pane reattaches and replays its screen and scrollback (up to `SCROLLBACK_LINES`, `lib/session.js`), including a full-screen program's alternate screen and modes such as bracketed paste.

## Links

- URLs in output and OSC 8 hyperlinks follow one policy (`frontend/src/terminal/links.ts`):
  - only an absolute `http:`/`https:` URL opens; anything else (`javascript:`, `data:`, `file:`, relative, protocol-relative) never does;
  - only on **Ctrl+click** (**Cmd+click** on macOS);
  - in a new window with `noopener,noreferrer`;
  - hovering shows the **real** target, so OSC 8 text cannot disguise it; a refused link shows `blocked link: …`.

## Copy and paste

- **Ctrl+Shift+C** copies the selection; **Ctrl+Shift+V** pastes (bracketed when the program asked for it). **Ctrl+C** stays `^C`.
- The browser's context menu and **Cmd+C/V** on macOS work too.

## Shell history

- One history file per **project**, shared by all its worktrees and all its shells: a command run in one shell is in a new shell's history at once, and in a running shell's after its next prompt. Another project never sees it.
- The user's own startup files cannot point history elsewhere.
- Where the files live: local projects `$PROJECTS_ROOT/.code-terminal/history/<project>`; projects on another System `$HOME/.local/state/code-terminal/history/<project>` on that System.
- **Shell support:**

| Login shell | History guarantee | How it starts |
|---|---|---|
| bash | yes | interactive, loading `/etc/profile` and the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` itself, then pinning history |
| zsh | yes | login shell; a `ZDOTDIR` wrapper sources the user's files, then pins history and gives `ZDOTDIR` back |
| any other | no | cc's default login shell with `HISTFILE` set; the shell may ignore it |

## Theme

- Background, foreground, cursor and selection follow cc's light/dark tokens live; the 16 ANSI colours are xterm's defaults. 256-colour and truecolor output render.
- Font: the host's Geist Mono.

## Standalone

- Opened without cc behind it (`npm start` alone), the page says to open it through code-conductor; nothing else works.

## Security decisions

- Not loaded: xterm's clipboard addon (OSC 52 cannot write the clipboard), image addon, WebGL addon, ligatures addon; xterm's `windowOptions` stay off.
- Titles, cc reasons and errors render as text, never markup.
- The request guard and CSP: [protocol](protocol.md#request-guard).
