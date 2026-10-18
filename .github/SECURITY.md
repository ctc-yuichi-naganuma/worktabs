# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's [private vulnerability reporting](https://github.com/worktabs/worktabs/security/advisories/new) (Security → Report a vulnerability).

Include what you found, the steps to reproduce it, the Worktabs version, and the OS (Windows, macOS, or WSL). Reports in English or Japanese are both fine.

Worktabs is maintained by one person in their spare time. You should get a first reply within a week. Fixes go into the next release; there are no backports to older versions.

## Supported versions

Only the latest release gets security fixes. Worktabs is an early preview at `0.x`.

## Scope

What Worktabs is meant to protect against is described in "Security assumptions" in the [README](../README.md#security-assumptions). In short: everything listens on `127.0.0.1` only, code-server and the hook receiver need a secret generated per start, and other programs running as the same user on the same machine are trusted.

These are in scope:

- Another user on the machine, or a web page in a browser, reaching code-server, the hook receiver, or the helper extension
- The secrets above leaking out of the app (to a log, a file other users can read, or a process that should not have them)
- Command injection through repository, branch, or issue data (for example in `git`, `gh`, or `claude` command lines)

These are out of scope:

- Programs already running as the same user on the same machine
- Vulnerabilities in code-server, the Claude Code extension, VS Code, or Electron themselves. Report them to those projects. A Worktabs setting or version that makes one of them exploitable is in scope.
- The installer and the app not being code-signed ([docs/releasing.md](../docs/releasing.md))
