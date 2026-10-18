# Known limitations

**English** | [日本語](ja/limitations.md)

## What has been tested

- Tested on Windows 11 and macOS 26.5 (Apple Silicon). Intel Macs and Linux are not tested.
- WSL is tested only on Ubuntu 24.04 with mirrored networking (`networkingMode=mirrored` in `.wslconfig`). With the default NAT, it should work, since nothing connects from WSL to Windows, but it is not tested yet.
- Not tested: approval in the VS Code diff editor. In Auto mode, edits go through as they are, so it rarely appears.

## Claude Code extension

- @-mentions do not suggest files (an extension issue, anthropics/claude-code#89933).
- With a process wrapper, the extension does not let the CLI choose the initial permission mode and passes `--permission-mode default` (Manual). So the app sets `claudeCode.initialPermissionMode` to `auto` (the `permissionMode` setting). `auto` is not among the choices in the extension's settings, but the value is passed through as `--permission-mode auto`.
  - This setting takes priority over the mode chosen in the panel. A mode switched in the panel applies only within that conversation.
- Reloading a tab interrupts the turn in progress (including one waiting for approval). The app asks for confirmation when a conversation is working.
- Inside an editor tab, if you pick another conversation from that tab's Session history, the previous conversation moves behind that tab (claude keeps running). The extension does not remember where this conversation is, so clicking its row opens the same conversation again in the right panel, and two claude processes run. The same happens when you open it from the extension's conversation list. "New session" in an editor tab opens a new tab, so it does not cause this.
- If the workspace settings (`.vscode/settings.json`) set `claudeCode.preferredLocation`, clicking a conversation row only shows the right panel and does not switch the conversation. The first conversation of a worktree made from an issue, PR, or task also opens in the place that setting names, not in the chat panel on the right ([architecture.md](architecture.md#helper-extension)).
- In the tab of a worktree made from an issue, PR, or task, one extra claude runs. The empty conversation created when the chat panel on the right first appears stays behind the conversation that received the instruction. The extension has no way to prevent this. The empty conversation is never started, so it has no row in the sidebar.
- Claude's live `unifiedWindows` field is internal and its background `get_usage` API is experimental. Version changes can make either path unavailable; the footer remains visible. Startup and 5-minute reads use the host computer's account, not WSL-only accounts. Real quota reads for both providers have been verified on Windows; macOS uses the same protocol but has not been verified with a signed-in installation.
- When the main turn has ended and only background subagents are running, the conversation looks done. When a subagent calls a tool, it goes back to working, and the elapsed time on the conversation row restarts from 0.

## Codex extension

- The [Codex verification matrix](codex-verification.md) records which environments were actually checked. Implemented integration and automated tests do not establish complete signed-in support on every OS. Windows native, WSL, and macOS each need their own official-extension acceptance run.
- New-worktree tasks are editable drafts and are never sent automatically. Codex composer integration depends on the installed extension's input shape. Unsupported or busy inputs retain the task in a warning with **Copy task** ([worktrees.md](worktrees.md#after-creating)).

- Linked worktree onboarding suppression uses the extension's internal first-run component, inspected in version 26.1007.21434. Older or changed implementations may still show the walkthrough; Worktabs leaves that UI usable. Primary onboarding is independent ([worktrees.md](worktrees.md)). Claude's linked-tab guidance suppression uses the supported `claudeCode.hideOnboarding` user setting; workspace overrides can take precedence.
- Automatic review is an initial preference for new conversations, not an override of existing thread permissions. It uses the active extension's permission picker. Older or changed picker implementations may not be recognized; Worktabs leaves them in their existing mode, normally manual approval. Check the Codex permission control for the effective mode. Availability depends on account features, runtime capabilities, and managed policy ([config.md](config.md)).
- Conversation state is observed only for the Codex app-server launched by a Worktabs tab's extension. Codex running separately in a terminal or another app is not included.
- The app manages `chatgpt.cliExecutable` in each instance to observe the extension's bundled CLI. This is a development setting in the extension. Workspace overrides and extension changes can bypass or break the integration.
- A conversation row navigates the Codex chat sidebar through the extension's URI handler. The local thread route is an extension integration point and may change with an extension update. Worktabs does not fall back to opening an editor tab; failed navigation shows a warning and tries to focus the sidebar.
- Only threads used or resumed in a Worktabs tab get saved rows. Worktabs stores navigation metadata, not conversation contents, and cannot restore a deleted log or a thread in a different Codex home. Archive/delete events from other apps are not observed while the Worktabs extension is stopped; an old row may remain until it is opened or hidden.
- Codex usage comes from extension notifications and quota reads at startup and every 5 minutes. Background reads use the host computer's account, not WSL-only accounts, and use the documented app-server protocol. Terminal and other-app usage appears on the next quota read or notification.
- API-key-only accounts have no subscription quota display. Missing data is unknown. A reset clears the percentage; after 15 minutes without a report, the display marks it stale and hides the percentage until another report arrives.
- The Codex footer shows the latest observed account, not several accounts at once. Account changes clear previous snapshots, including those from other tabs. Account updates without identity are handled conservatively; other tabs must report account state again to contribute. Values are not kept across app restarts ([usage.md](usage.md#codex-usage)).

## GitHub

- For repositories whose remote is not GitHub (GitLab, Bitbucket, Gitea, in-house Git servers, or no remote), the GitHub button, the PR and CI on worktree rows, the dot for approved PRs, the visibility icon, and adding a worktree from an issue or PR are not available. The top field of the add-worktree dialog works only as a task ([worktrees.md](worktrees.md#adding)). The icon on the repository row also appears for GitLab and Bitbucket.
- Whether a remote is GitHub is decided when the app reads the remote, and is remembered ([architecture.md](architecture.md#github-buttons)). After you sign in to a GitHub Enterprise host with gh or change `~/.ssh/config`, read it again with the refresh button at the top.
- SSH aliases are resolved from `~/.ssh/config` with `ssh -G`. When git uses another ssh (`core.sshCommand`, `GIT_SSH_COMMAND`, PuTTY's plink, and so on), that configuration is not read. If ssh does not know the alias, the host name in the URL is used as is.
- The PR shown on a worktree row is only one opened from a branch in the remote's repository (origin, or the first remote if there is no origin). A PR pushed to a fork and opened against upstream is not shown. This is the same as "the PR for this branch" (`gh pr view`). Only for a worktree made from a PR is the PR shown even when it comes from a fork ([worktrees.md](worktrees.md#creating-from-a-pr)). The same applies to the PR shown in the confirmation for removing a worktree.
- In the confirmation for removing a worktree, commits count as kept in a merged PR only when the branch head equals the last commit of the PR. If you have not pulled commits pushed to the PR later (the branch is older than the PR), the commits are in the PR, but the app still warns as before.
- Only commands that Claude runs make the app catch the push and read CI again shortly after. A push from the VS Code terminal or VS Code's "Sync Changes" shows up at the next refresh (when Claude finishes its work, when the window comes to the front, and so on). The same goes for a merge on the GitHub site.
- The visibility icon on a repository row changes only when the list is read again (at startup, with the refresh button, or after "Add repository…"). After you change the visibility on GitHub, read it again with the refresh button.
- CI results read up to 30 checks per commit. Beyond that, some names do not appear when you hover (only the count appears, as "and N more checks").

### Repositories not cloned yet

- In an org that restricts third-party application access, private repositories are not returned unless gh's OAuth app (GitHub CLI) is approved. For that org, only public ones are listed.
- GitHub Enterprise (Server and Cloud) is tested only with tests that mock gh's responses, since no environment is available to try it. It is not tested on a real instance.
- The list includes only the accounts that gh on Windows or macOS is signed in to. Accounts that only gh inside WSL is signed in to are not listed.
- The list asks GitHub only when the list is read again (at startup, with the circular arrow, or after "Add repository…"). After you create a repository on GitHub, read it again with the circular arrow.
- A repository cloned into a folder that is not in the list (a folder outside the ghq layout that you have not added with "Add repository…") is not recognized as cloned.
- The distros offered as WSL clone destinations are only the ones read through `repoSources` ([wsl.md](wsl.md#cloning)). If `"repoSources": ["ghq"]`, written by an earlier version, is still there, WSL is not offered.
- A clone cannot be stopped until it finishes (it times out after 10 minutes). It cannot answer the prompt to accept the host key when SSH connects to a host for the first time, so run `ssh -T git@<host>` once in a terminal first.

## VS Code settings

- Extensions absent from Open VSX can be imported from desktop VS Code or VSIX when publisher terms permit code-server use. This does not guarantee compatibility or grant Marketplace access. Imported extensions need source updates and re-importing ([extensions.md](extensions.md)). WSL imports do not yet have automatic probe-based rollback.

- Even tabs of the same repository do not share enabled or disabled extensions, panel layout, command history, or the state that extensions store on the browser side (globalState). VS Code Web keeps these in the browser's IndexedDB, per origin (port).
- WSL installs configured app-managed extensions, matching Linux imports, and the helper. Windows imports are not copied to WSL; manually installed Windows extensions also need a compatible Linux installation.

## Memory

Each running tab uses about 0.56 GB (code-server) and about 0.24 GB (one claude session). On top of that, Electron as a whole uses about 0.9 to 1 GB. Suspending tabs you are not using frees their memory ([usage.md](usage.md#suspend-and-restore)).

## macOS

- Clicking a notification opens the conversation only while the app is running. After the app restarts, clicking a notification in Notification Center does not jump to the conversation (on Windows it does; [architecture.md](architecture.md#notifications)).
- "Open in Finder" in the sidebar's context menu and "Reveal in Finder" in the VS Code Explorer's context menu do not group windows into tabs as on Windows.
- There are no WSL tabs.
- The app menu has only the app, Edit, and Window menus. To pass Cmd+W (close the VS Code tab) and Cmd+N to VS Code, it does not show the File menu or a close-window item.

## Windows

- The way the app opens folders in File Explorer tabs (`WM_COMMAND 0xA21B`) is not something Windows documents. If a Windows update breaks it, the folder opens in a new window.
