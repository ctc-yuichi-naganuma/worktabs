# Adding and removing worktrees

**English** | [日本語](ja/worktrees.md)

You add and remove worktrees from the sidebar. Worktrees made outside the app, with `git worktree`, Orca, and so on, show up in the list as they are and open the same way.

Linked worktree tabs skip the agents' introductory guidance. Claude uses `claudeCode.hideOnboarding`; Codex uses its walkthrough's completion callback to return to chat, including when a completed walkthrough reappears. Primary keeps its own onboarding and Claude preference. The rule also applies to subfolders of a linked worktree and works without opening primary first. Reopening a panel or restarting Worktabs applies it again.

`claudeCode.hideOnboarding` stays per tab and is not shared with the repository's other tabs. Worktabs sets it to `true` when a linked tab starts. Authentication and permissions still use the agent's normal flow. Codex integration depends on recognizing the extension's internal walkthrough; an unsupported version keeps its original UI ([limitations.md](limitations.md#codex-extension)).

## Adding

The "＋" on a repository row, or "Add worktree…" in its right-click menu, opens the add dialog. It has two fields.

- **Issue, PR, or what to do** (it can be left empty): a GitHub issue or PR (`#20`, `20`, or the URL of an issue or PR), or a sentence describing the task (for example, `Make the sidebar width adjustable by dragging`).
  - For an issue, the app reads its title with `gh issue view` and shows it below. For a closed issue, "(closed)" appears.
  - For a PR, the app creates a worktree that checks out the PR's branch (see "[Creating from a PR](#creating-from-a-pr)" below).
  - When you enter only a number, gh's answer decides whether it is an issue or a PR. Issues and PRs of other repositories are not used.
  - gh runs where the repository is (for a WSL repository, the gh inside WSL, which must be signed in there).
  - For a repository whose remote is not GitHub (GitLab, Bitbucket, Gitea, an in-house Git server, or no remote at all), the field is labeled "What to do" only, and everything you write is treated as a task. `#20` and issue URLs are not read with gh either; the text is used as is to pick the branch name and to fill the input box of the new conversation.
    - A bare number (`#20`, `20`) is not enough to pick a branch name. A note below the field says so, and "Suggest a branch name" is disabled. You can still create the worktree if you type a branch name yourself.
    - Whether the repository is on GitHub is decided from the remote the sidebar read ([architecture.md](architecture.md#github-buttons)).
- **Branch name**: while you type, a description of what will happen appears below.

Enter creates the worktree. Esc cancels.

### Suggesting a branch name

Pressing "Suggest a branch name" next to the top field makes Claude (`claude -p`, Sonnet) pick a branch name from the issue or task in the top field and put it into the bottom field. You can edit the name before creating.

- If you fill in the top field and press Enter with the branch name empty, the app also suggests a name.
- It takes about 5 to 10 seconds (about 3 seconds of that is starting claude). If you change the top field while it is working, the suggested name is not used.
- The app passes recent branch names (local and remote, the 15 newest) as examples, so the name follows the repository's convention, such as `feat/issue66`. For an issue, the number goes into the name.
- claude runs where the repository is (for a WSL repository, the claude inside WSL, which must be signed in there). It uses no tools, no MCP servers, and none of your user settings (hooks and so on), and it does not keep the conversation (`--no-session-persistence`). The conversation that picked the name does not appear in Claude's conversation list.
- Usage comes out of the same limits as your normal Claude use (about 1,000 tokens per call).
- For a PR, the app does not ask Claude. It puts in the name of the PR's branch (the button becomes "Use the PR's branch name").

### Creating from a PR

From a PR number or URL, the app creates a worktree for reviewing someone's PR or running it locally (it checks out the branch the same way as `gh pr checkout`).

- The app reads the PR with `gh pr view` and shows its number, title, and branch below the top field (for example, `PR #71 Title (branch feat/x)`). A fork's branch is shown like `alice:patch-1`, and merged or closed PRs also show "merged" or "closed".
- Pressing Enter in the top field (or "Use the PR's branch name") fills in the branch name field. Pressing Enter again creates the worktree. You can edit the name.
  - For a PR from a branch in the same repository, the name is that branch's name (`feat/x`).
  - For a PR from a fork, the fork owner is prefixed (`alice/patch-1`). This keeps it apart from the fork's `main` and from branches with the same name in other forks. If the fork has been deleted, the name is `pr-<number>`.
- Before creating, the app fetches the PR's branch (the description shown while you type says "Fetches …"). Someone else's branch is often missing locally or out of date.
  - Open PR from the same repository: the app fetches `origin/<branch>` and creates a branch that tracks it (the same as "a branch that exists only on the remote"). Pushing adds to the PR.
  - PR from a fork, and merged or closed PRs: the app fetches `refs/pull/<number>/head`, which GitHub keeps for every PR, and creates a new branch. Merged or closed PRs may have had their branch deleted. Later pushes to the PR can be brought in with pull (the app sets `branch.<branch name>.merge` to `refs/pull/<number>/head`, the same as `gh pr checkout`). There is no push target.
- If a local branch with the same name exists, the app checks it out as it is without fetching (the description shown while you type says "the PR is not fetched"). Bring in new commits with pull.
- The app fetches from the remote of the repository that `gh pr view` read (origin, or the first remote if there is no origin).

### After creating

- The app opens the tab, opens a new conversation with the tab's selected agent, and moves focus to its input box (it waits for VS Code to start, so this takes about 10 seconds). If you started the conversation first and then moved to the worktree, the conversation panel would stay in the original tab's VS Code, which is why it happens in this order.
- When created from an issue, the app writes the issue number and title into the branch's git config (`branch.<branch name>.worktabs-issue` and `branch.<branch name>.worktabs-issue-title`). The worktree row in the sidebar shows it like `#20`, and clicking it opens the issue on GitHub. Deleting the branch deletes this config too.
- When created from a PR, the app writes the PR number and title the same way (`branch.<branch name>.worktabs-pull` and `branch.<branch name>.worktabs-pull-title`). The worktree row shows that PR with its state color and CI result ([usage.md, "PRs and CI"](usage.md#prs-and-ci)). This works for PRs from forks and for branches whose name differs from the PR's.
- If you filled in the top field, the app puts text into the input box of the new conversation: for an issue, `Implement GitHub issue #20 "title"`; for a PR, `Review GitHub PR #71 "title"`; for a task, the sentence itself. It is not sent, so you can edit it before sending.
  - This conversation opens in the chat panel on the right. It opens there even if the Claude Code extension setting `claudeCode.preferredLocation` is `panel` (an editor tab). Only when the workspace settings (`.vscode/settings.json`) set `preferredLocation` does it open in that place.
  - Both Claude Code and Codex receive an editable draft. Worktabs never sends the task automatically. Review it and send it yourself.
  - Codex input depends on the installed extension's composer. Worktabs waits briefly for a visible, empty, local new-conversation input. It leaves existing threads and drafts alone. If opening or filling fails, a warning shows the task and offers **Copy task** so you can paste it into a new conversation.
  - With Claude Code, the empty conversation created when the right chat panel first appears stays in the background, and one extra claude runs for it ([limitations.md](limitations.md#claude-code-extension)).
  - If the top field is empty, the app just shows the right chat panel.

### Location and branch

- The worktree goes next to the repository, at `<repository name>-<branch name>` (a `/` in the branch name becomes `-`; for example, `feat/x` in `worktabs` goes to `..\worktabs-feat-x`).
- If a local branch with the same name exists, the app checks it out. If it exists only on the remote, the app creates a branch that tracks it. If it exists in neither, the app creates a new branch from the default branch (the description shown while you type says something like `Creates a new branch from origin/main in ..\repo-feat-x`). When creating from a PR, see "[Creating from a PR](#creating-from-a-pr)" above.
  - The starting point is the remote's default branch (such as `origin/main`, which `origin/HEAD` points to). Even if primary has another branch checked out, the app does not start from that branch. It uses `origin/main` instead of the local `main` because when primary is on another branch, the local `main` is not pulled and is often out of date.
  - The app does not fetch before creating. `origin/main` gets updated by VS Code's automatic fetch and by pulls in other worktrees. To start from the latest, fetch first.
  - The new branch gets no upstream. VS Code's "Publish Branch" pushes it to a remote branch with the same name.
  - If there is no remote, or no `origin/HEAD` (for example, a repository where `git remote add` was run after `git init`), the app looks for the local `main`, then `master`. If neither exists, it starts from the branch checked out in primary. You can create `origin/HEAD` with `git remote set-head origin --auto`.
  - The remote used is `origin`, or the first remote if there is no `origin`.
- Even if the worktree is created under ghq, it is not counted as a repository in the ghq list. It appears only under its original repository.

### Copying gitignored files (`.worktreeinclude`)

If there is a `.worktreeinclude` at the root of the repository, the gitignored files listed in it (such as `.env`) are copied from primary into the new worktree. The syntax and rules are the same as Claude Code's [`.worktreeinclude`](https://code.claude.com/docs/en/worktrees#copy-gitignored-files-into-worktrees), so one file also works for the worktrees Claude Code creates.

- The syntax is the same as `.gitignore`. Only files that match a pattern and are gitignored are copied. Files tracked by git are not copied.
- Inside a folder that is gitignored as a whole (such as `node_modules`), the app searches only when a pattern contains that folder's name (for example, `**/.claude/skills/*.md` searches inside `.claude/`, and `**/config.json` does not). Large folders take a long time to copy, so do not list them.
- A file is not copied when one of the folders on its way is a symbolic link (or a junction) in the new worktree. That link comes from the branch, which may be someone else's pull request, and it could send the file out of the worktree or into a folder git tracks.
- The description shown while you type shows the number of files to copy. If some files cannot be copied, the worktree is still created, and the app tells you which files could not be copied.

## Removing

Remove a worktree with "Remove worktree…" in its right-click menu, or with the trash button that appears when you hover over the row of a worktree that is not open (it does not appear for primary).

- The trash button appears only on rows of worktrees not open as tabs. An open row has an × at its right end, and having both side by side makes it easy to remove a worktree when you meant to close it. To remove an open worktree, close it with × first.
  - The trash button appears at the right end of the row, where × is on an open row. After closing with ×, you can click the same spot again to remove it. Clicking only shows a confirmation, so clicking × twice does not remove anything right away.
  - It does not appear for locked worktrees or for worktrees being removed.
  - For a worktree whose PR is merged and whose branch head matches the PR's last commit (see below), the trash button shows even without hovering. This makes finished worktrees easy to find. The PR is the same one shown on the row, so gh is not called any more often.
- The app does not remove the worktree in these cases. Clean up first.
  - Claude is working or waiting for approval in that worktree (including a conversation that moved there from another tab)
  - There are unsaved files
  - There are uncommitted changes (including new files)
  - The worktree is locked with `git worktree lock`
- In the confirmation dialog, you can choose whether to delete the branch too. If it has commits that are not in any other branch, remote, or tag, the dialog shows how many, and deleting the branch is off by default.
- The confirmation dialog also shows the state of the branch's PR ("PR #12 is merged.", "PR #12 is not merged yet (open).", "PR #12 was closed without merging."). The PR is chosen the same way as for the worktree row; for a worktree created from a PR, it is that PR.
  - If the PR is merged and the branch head matches the PR's last commit (`headRefOid`), then even if there are commits found nowhere else, the dialog shows their number with "all of them are in PR #12", and deleting the branch is on by default. The dialog is not shown as a warning either. After a squash merge or rebase merge, GitHub deletes the remote branch, and once a fetch removes the remote-tracking branch, the branch's commits exist nowhere else. GitHub still keeps the PR's commits (`refs/pull/<number>/head`), so you can restore them with `git fetch origin pull/12/head:feat/x`.
  - If the head differs from the PR's last commit, for example because commits were added after the merge, the dialog says so and treats commits found nowhere else as before (it warns, and deleting the branch is off by default).
  - If gh is missing or not signed in, there is no PR, the branch is the default branch, or no answer comes within 5 seconds, the dialog asks for confirmation without the PR state. This keeps the confirmation from waiting long. The PR is read in parallel with counting commits found nowhere else.
- Gitignored files that are missing at the same path in primary, or whose content differs, are listed in the confirmation dialog (up to 20; when there are more, "and N more"). These are things like a `.env` or `.claude/settings.local.json` edited in the worktree, or notes you put there by hand. git does not count them as changes, so they would disappear silently. They do not block the removal.
  - Files copied with `.worktreeinclude` and left unchanged have the same content as in primary, so they are not listed.
  - The app does not look inside folders that are gitignored as a whole (such as `node_modules/` and `dist/`). They can usually be rebuilt, and listing them every time would make people stop reading the dialog.
- When there are commits found nowhere else (except those kept in a merged PR), or there are gitignored files to list, the dialog is shown as a warning, and Enter cancels.
- When you delete a branch together with commits found nowhere else (except those kept in a merged PR), the app shows the branch name and its head commit in a Windows notification (for example, `Deleted the branch feat/x (abc1234)` and `To bring it back: git branch feat/x abc1234`). Removing a worktree also removes the history of its HEAD (the reflog), so the commits could no longer be traced later. The notification stays in the notification center, so you can look it up later. This works until git cleans up commits that nothing points to (`git gc`).
- A worktree whose folder was deleted by hand stays in git's list (`git worktree list` shows it as prunable), so it also stays in the sidebar. The trash button or "Remove worktree…" in the right-click menu removes the record left in git. Commits found nowhere else are counted even when the folder is gone.
  - A folder that exists but that git cannot treat as a worktree (for example, its `.git` file was deleted) is not removed. This avoids deleting files the app could not check.
- An open tab is closed and its code-server stopped before removal. If a program is using the folder, the app waits a while and tries again. If it still cannot remove it, close Explorer (Finder on macOS) and terminals, then remove it again.
- The VS Code state of the removed worktree's tab (open files and so on) is deleted too, and the tab's port is forgotten ([architecture.md](architecture.md#code-server)).
- After removal, the app brings primary of the same repository to the front (opening it if it is not open). Work on that repository, such as merging or adding the next worktree, continues there.
  - It moves to primary no matter where you removed from (the trash button, the worktree row's right-click menu, or the tab's right-click menu), whether the removed worktree's tab was open or closed, and even if tabs of other worktrees of the same repository are open.
  - It moves when you choose "Remove" in the confirmation. Even if removal fails, you stay on primary. When you cancel the confirmation, or when the worktree cannot be removed (see above), the tab does not change.
  - When you only close a tab with ×, the app moves to the neighboring tab (not to primary).
- Junctions and symbolic links inside the worktree (such as a link to another worktree's `node_modules`) are only unlinked. On Windows, `git worktree remove` would also delete the contents of the link target.
