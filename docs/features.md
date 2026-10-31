# Features

> See also: [README](../README.md) · [protocol](protocol.md) · [architecture](architecture.md)

## Layout of the page

- **Tab bar** — one tab per open checkout, over the whole width. **+** (`Open checkout`) opens the picker.
- **Workspace** — the active tab's split layout. Width capped by cc's session width (`--cc-session-width`).

## Tabs

- A tab is one **checkout**: a project's main checkout, or one of its worktrees. Its label is `<project>` or `<project>/<worktree>`; each tab has its own split layout, and every shell in it runs in that checkout.
- Per tab: a `⋮` actions button (`Actions for <label>`; a right-click on the tab opens the same menu) and `×` (`Close <label>`).
- **Menu:** **Close**, **Close others** (only with more than one tab), **Copy name** (the label, to the clipboard). Arrow keys move, Esc closes.
- **Closing a tab** (×, menu, **Close others**, the gone banner's **Close tab**):
  - the page asks the backend for the running shells of the target checkouts; when there are any (or the count cannot be fetched), a dialog says how many will be killed — **Cancel** sends nothing, **Kill shells and close** proceeds;
  - the backend then kills every shell of the checkout (including ones the page does not list) and deletes its saved layout; the tab goes away only after that succeeded, else it stays and the error is shown;
  - a shell that finishes opening after its tab closed is killed at once.
- **Shortcuts:** Ctrl/⌘+1…8 activate that tab, Ctrl/⌘+9 the last. They work while focus is inside the page, including inside a terminal, and the key never reaches the shell. Not handled while a dialog is open.
- **Persistence:** the open tabs and the active one are kept per browser (`localStorage`, key `code-terminal:tabs`); layouts and shells live on the backend. The active tab is mirrored into the URL: `?project=<name>` (main checkout) or `?project=<name>&worktree=<name>`. Opening such a URL adds or activates that tab; browser back/forward do the same. Restoring tabs never starts a shell. A click from cc's row menu arrives as `?ccProject=` params and is replaced in place by this route, so a reload or Back never repeats it.
- **Gone checkout:** when cc's project list no longer has the tab's project or worktree, its tab is struck through and a banner above the layout says so, with **Close tab**. Its shells keep running until the tab is closed; New shell, split and Restart show cc's refusal.
- **Shells no pane shows** (a layout save was lost, or another browser's older layout overwrote this one): a banner "N shells in this checkout are not in this layout" with **Show**, which gives each a pane beside the focused one. Never automatic: a shell has one client, and adopting it would take it from another browser.

## Open from code-conductor

- cc's sidebar adds **Open terminal** to the `⋮` menu of every project row and every worktree row, in a group labelled with the plugin's name. A project row opens its main checkout; a worktree row opens that worktree.
- It behaves like choosing the checkout in the picker:
  - the checkout's tab is opened, or selected when it is already open (never duplicated);
  - a checkout with no saved layout gets one shell; one with a layout shows it and gets no new shell;
  - when the project's System cannot run terminals, the tab opens with no shell and shows cc's reason.
- An already-open page retargets in place: the frame is not reloaded.
- The name cc sends is checked against a freshly fetched project list first. An unknown project or worktree, a missing project, or a failed fetch shows the alert (the name as plain text) and leaves the open tabs and the active tab as they were; nothing is requested for it.

## Checkout picker

- Opened by **+** or **Open a checkout**; the project list is reloaded each time it opens.
- Projects grouped by workspace (alphabetical, **No workspace** last), alphabetical within; the filter box matches a project or workspace name, case-insensitively.
- Per project: a chevron (`Show checkouts of <project>`) listing **(main checkout)** and each worktree with its branch; the name button opens the main checkout. A project on another System carries a `<system> · <remoteId>` badge.
- **Running count:** a `N running` badge on each checkout with running shells, counting only that exact checkout; absent at 0.
- **Availability:** a project whose System has no pty is disabled with cc's own reason (its name and chevron); "System unreachable: …" and "Terminals may not open: …" stay enabled, so the user can retry.
- Picking a checkout opens its tab (or activates it when open). When it has no shells yet and terminals can open, one shell is started.
- A failed listing shows the message and **Retry**.

## Workspace

- No tab open: "No checkout open." and **Open a checkout**.
- Empty layout: "No shells in <label> yet." and **New shell** — disabled with cc's reason when the System has no pty.
- Layouts persist per checkout on the backend, so the arrangement survives a reload or another browser. A change still waiting to be saved (a closed pane, a dragged divider) is sent when the page is hidden or reloaded.
- Inactive tabs are unmounted: switching back reattaches each pane and replays its screen.

## Panes

- Header: the program's title (as text) or else the tab's label, and three buttons: **Split side by side**, **Split stacked**, **Close shell**.
- A split opens a new shell in the tab's checkout. **Close** kills the shell; its sibling takes the space and focus moves there.
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

- **Restart** opens a new shell in the same checkout, in the same pane.
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
