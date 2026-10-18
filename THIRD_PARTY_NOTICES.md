# Third-party notices

Worktabs is licensed under the MIT License (see [LICENSE](LICENSE)). This file lists the third-party software that the Worktabs installer and zips contain, and the software that Worktabs downloads at run time.

## Included in the installer and zips

### Electron

- License: MIT
- Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.
- https://github.com/electron/electron

Electron contains Chromium, Node.js, and other open source components. On Windows, electron-builder places their licenses next to `Worktabs.exe` as `LICENSE.electron.txt` and `LICENSES.chromium.html`. The same texts are in each [Electron release](https://github.com/electron/electron/releases) (`LICENSE` and `LICENSES.chromium.html` in the release zips).

### Extension import dependencies

The installer also includes [adm-zip](https://github.com/cthackers/adm-zip) (MIT), [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) (MIT), and [node-semver](https://github.com/npm/node-semver) (ISC), with their runtime dependencies. Their license files are included with the packaged Node modules.

### Conversation provider marks

The sidebar uses the Claude starburst and OpenAI knot only to identify Claude Code and Codex conversations. These marks belong to Anthropic and OpenAI, respectively, and are not covered by Worktabs' MIT License. Worktabs is not affiliated with or endorsed by either company.

- Claude: the original 24px path from `resources/claude-logo.svg` in Anthropic's Claude Code extension, version 2.1.286 ([official distribution](https://open-vsx.org/extension/Anthropic/claude-code)).
- Codex: the original 24px path from `resources/blossom-black.svg` in OpenAI's Codex extension, version 26.1007.21434 ([official distribution](https://marketplace.visualstudio.com/items?itemName=OpenAI.chatgpt), [OpenAI brand guidelines](https://openai.com/brand/)).

### Code written for Worktabs

`claude-wrap.exe` (built from `native/ClaudeWrap.cs`) and the helper extension (`worktabs-helper-*.vsix`, built from `helper-extension/`) are part of Worktabs and are under the same MIT License.

The Windows installer is built with NSIS (zlib License), which needs no notice in the installer.

## Downloaded at run time (not included)

Worktabs does not ship the following. It downloads them on the user's machine when it starts or updates, and each is used under its own license.

| Software | Source | License |
|---|---|---|
| code-server | GitHub releases of [coder/code-server](https://github.com/coder/code-server) | MIT |
| Claude Code extension (`anthropic.claude-code`) | [Open VSX](https://open-vsx.org/extension/Anthropic/claude-code) | Anthropic's license ([terms](https://www.anthropic.com/legal/commercial-terms)) |
| Japanese language pack (`MS-CEINTL.vscode-language-pack-ja`) | [Open VSX](https://open-vsx.org/extension/MS-CEINTL/vscode-language-pack-ja) | MIT |

The Claude Code extension is not part of Worktabs. Using it needs your own Claude account, and you must follow Anthropic's terms of service. Worktabs is not affiliated with or endorsed by Anthropic.
