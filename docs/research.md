# Design research

Extension acquisition now also supports user-provided desktop VS Code and VSIX imports, subject to publisher permission and compatibility. Claude retains Open VSX as its default. Current workflows and limits are in [extensions.md](extensions.md); the historical investigation below is unchanged.

This page summarizes the research and the stage 0 spike that came before Worktabs, and the design decisions they led to. It is a summary written for publication. The original notes (in Japanese, dated September 2026) are not published, because much of their detail about other products and specific versions goes stale quickly.

Everything below describes the situation as of late September 2026. Other products change fast, so treat the comparisons as a snapshot, not as a current review. For how the app works today, see [architecture.md](architecture.md).

## The question

Can a small app put one browser-based VS Code per git worktree into the tabs of a single window, and use the full GUI of the Claude Code VS Code extension (`anthropic.claude-code`) in each tab, on Windows?

The requirement was the extension's own GUI, not just "parallel Claude sessions with worktrees". If you only need the latter, existing tools already cover it (see below).

## Why existing tools were not enough

- **Standalone agent environments** (Conductor, Nimbalyst, Claude Squad, Superset, Emdash, Orca and others) do not host a VS Code extension host. They either run CLI agents in an embedded terminal or build their own chat UI on top of the Agent SDK. The editor is Monaco at most, or a hand-off to an external VS Code.
- **VS Code and its forks** (Cursor, Windsurf and others) run the extension unmodified, but their worktree features are built for their own agents. The "Claude" in the VS Code Agents window is a separate harness provided through Copilot, not the Claude Code extension, and was still in preview.
- **The Claude Code extension** has no per-conversation worktrees ([anthropics/claude-code#69554](https://github.com/anthropics/claude-code/issues/69554)).
- **The Claude desktop app** has parallel sessions with worktrees, but no VS Code editor or extensions.
- **One desktop VS Code window per worktree** works, but Windows cannot group VS Code windows into tabs (`window.nativeTabs` is macOS only), and you have to look at each window to see which conversation is waiting for you.
- Products that run a full VS Code per task (for example in a container) isolate by environment, not by local worktree, and leave tabs to the browser.

No product found ran a full VS Code per local worktree as tabs on Windows.

## Decisions

### Build a thin wrapper, and treat it as a stopgap

The gap could be closed from either side (worktree support in the extension, or the VS Code Agents window maturing), so the wrapper is kept thin: it reuses code-server and the Claude Code extension as they are and does not build its own chat or editor. When the extension gains a feature, the app gets it for free.

### Embed browser-based VS Code, not desktop VS Code

Embedding another process's desktop window is not a supported model on Windows (input queues get attached, so one hang freezes both) and is not possible on macOS. A browser-based VS Code served locally can be shown in an Electron view instead.

### Use code-server

| Option | Outcome |
|---|---|
| code-server | Chosen. MIT, follows VS Code releases closely, has the flags needed for many instances (`--user-data-dir`, `--extensions-dir`, `--bind-addr`, `--cookie-suffix`), and shipped native Windows builds from v4.137.0 (2026-09-11). |
| openvscode-server | Rejected. No release since early 2026 and no maintenance signal. |
| `code serve-web` | Rejected for distribution. Its license allows personal and internal use but not embedding in an app that others use. |

### One `WebContentsView` per tab

Electron discourages `<webview>` and recommends `WebContentsView`. Each tab gets its own renderer process; switching tabs only changes visibility, so hidden tabs keep their VS Code state.

### One code-server process per worktree

Each worktree gets its own process, with its own user data folder and a shared extensions folder. This keeps worktrees isolated and lets the app stop idle ones to free memory.

### Track conversation state with hooks, keyed by session

The app receives Claude Code hooks over HTTP on `127.0.0.1` and keeps state per `session_id`, not per tab, because events from an old session can arrive late and would overwrite a tab-level state. A missing or stopped app must never block Claude, which HTTP hooks guarantee (a failed connection does not block).

### Never discard a busy view

In browser-based VS Code, the extension host's life is the agent's life: closing or reloading the page interrupts the running turn. So the app never destroys a tab that is working or waiting for input, and only puts a tab to sleep after its conversation is done and it has been idle for a while.

## What the spike confirmed

The stage 0 spike ran code-server 4.139.1 (native Windows), extension 2.1.283 and Electron 44 on Windows 11.

| Risk | Result |
|---|---|
| The extension's webview does not work inside Electron | Works. Chat panel, permission prompts and inline diffs render in `WebContentsView`. |
| Native Windows code-server is too new | Works, with one bug in the default `?folder=` redirect (see below). |
| Hooks do not fire on Windows | All events used fire: SessionStart, UserPromptSubmit, Pre/PostToolUse, PermissionRequest, Notification, Stop, SessionEnd. The exception is rejecting a permission, after which no hook fires. |
| Plain HTTP blanks the chat panel | Not an issue on loopback: `http://127.0.0.1` is a secure context, so Service Workers and `crypto.randomUUID` work. |
| Authentication | No login needed. code-server runs as the same user, so the extension uses the existing `~/.claude` credentials. |
| @-mentions in the chat input | Broken in code-server (an upstream bug). Accepted. |
| Memory | Larger than estimated: about 1.1–1.4 GB per code-server instance, plus about 0.3 GB per Electron view. |

## Pitfalls found, and how the app handles them

- **Background throttling.** Chromium throttles hidden and occluded pages. In that state the chat panel stopped rendering and a tool call stalled for about two minutes. The app disables renderer backgrounding and background timer throttling.
- **Rejected permissions fire no hook.** The conversation would stay "waiting for input". The app also watches the transcript for the interruption record.
- **`?folder=` on Windows.** The default redirect uses a `C:\...` path that the browser treats as relative. The app builds the URL itself in the `/c:/...` form.
- **Leaking environment variables.** Launching from a VS Code terminal or from Claude leaks `ELECTRON_RUN_AS_NODE`, `CLAUDECODE`, `VSCODE_*` and similar into code-server and nested `claude` processes. The app removes them before starting code-server.
- **Child processes survive on Windows.** Stopping only the launched process leaves code-server and `claude` running. The app stops the whole process tree.
- **Injecting hooks without touching user settings.** The extension's documented `claudeCode.claudeProcessWrapper` setting lets the app launch `claude` through its own wrapper, which adds `--settings` with the app's hooks. Neither the user's settings nor the repository are modified. This became claude-wrap (Windows), and later the macOS and WSL wrappers.
- **Authentication between instances.** Cookies are not separated by port. The prototype used `--auth none` on loopback; the app now passes a random per-launch password hash and writes the cookie itself, with `--cookie-suffix` per instance.
- **Built-in AI features.** Turning off VS Code's built-in AI features cut memory per instance by about 30%.
- **Keybindings.** Without an application menu, Ctrl+W, Ctrl+Tab, Ctrl+P and Ctrl+number reach VS Code. Ctrl+W also closes the Claude tab, which is VS Code's normal behavior.

## Where the app went beyond the original plan

The research targeted Windows only and a top tab bar. The app later moved to a left sidebar (repository → worktree → conversation), and added macOS, WSL tabs, usage display, GitHub status, and worktree creation from issues and PRs. These are described in the other pages under [docs/](.).

## Conversation provider marks

Worktabs first kept Claude and Anthropic marks out of the app. That decision was revisited for conversation rows: generic symbols did not let users recognize which agent owned a conversation.

Conversation rows now use the Claude starburst and the OpenAI knot used by the Codex extension, only to identify the provider. They are separate from the state badge. The marks are not used as Worktabs' app icon or logo and do not imply affiliation or endorsement. Their original paths come from the official extensions; ownership and sources are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The tooltip and accessible label also spell out Claude Code or Codex.
