# Changelog

Built with [git-cliff](https://git-cliff.org) from the prefixes of the commits ([Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)), not written by hand. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions follow [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-10-13

### Features
- open Extensions from the update card instead of a separate sidebar button
- show a moving bar while updates and extension actions run
- add the Worktabs app icon
- prefill Codex tasks in new worktree conversations
- prefer Codex automatic approval review when available
- restore Codex threads in the chat sidebar
- show Codex usage limits in the sidebar footer
- manage extension imports and source-aware updates
- track Codex conversation state in Worktabs
- manage Codex editor settings

### Bug fixes
- check code-server releases through gh, and keep Open VSX updates when GitHub fails
- import extensions larger than 1 GB, such as Codex
- wait for startup preparation before opening tabs
- keep sidebar badges and archived rows current
- keep open repositories in their section during startup
- sign macOS bundles for native notifications
- recognize official Codex composers after startup
- confirm Codex thread visibility before completing a reveal
- translate settings and extension management into Japanese
- put the status indicator before the agent icon
- skip repeated agent onboarding in linked worktrees
- recover stale Codex usage and show refresh failures
- keep unread results until their conversation is shown
- show the Claude mark in Claude's orange, at the GitHub mark's size
- make Claude and Codex conversation icons recognizable
- update with Codex tabs open when Worktabs can see their turns
- hide internal Codex metadata threads from the sidebar
- simplify subscription usage rows
- refresh usage at startup and keep provider status visible
- use extension-bundled CLIs for branch name suggestions
- finish Codex settings integration
- render open repository rows
- keep the sidebar usable while repositories load

### Refactoring
- coordinate worktree removal outside Electron
- separate sidebar row rendering from page coordination
- coordinate conversation opening outside Electron
- coordinate extension management outside Electron
- inject GitHub command execution and host lookup state
- move shared command execution out of worktrees
- centralize mounted webview compatibility discovery
- share code-server launch policy across backends
- share active extension inventory parsing
- separate conversation state from runtime observation
- separate sidebar selectors and request scheduling
- coordinate repository refreshes outside Electron
- coordinate update transactions outside Electron
- coordinate tab lifecycle outside Electron

### Documentation
- record Codex verification scope and setup
- share the Japanese translation workflow
- document shared agent bootstrap
- use AGENTS.md as shared agent guide

### Tests
- catch sidebar browser timer failures during rendering
- bound the folder watcher readiness check
- cover sidebar open repository rendering

### Chores
- record why branch names use the Sonnet alias

### Other
- Add Codex agent settings

## [0.3.2] - 2026-10-09

### Features
- say how to add a repository when the list is empty, and keep row names readable in English
- follow the system language by default, and install the language pack VS Code needs
- write the messages of the modules in English, with Japanese from the table
- write the sidebar and the dialogs in English, with Japanese from the table
- write the main process UI in English, with a Japanese translation table
- Approve 済みでマージしていない自分の PR があるリポジトリの、アイコンの右上に赤い点を出す

### Bug fixes
- open links to a local dev server at its port, not through code-server's proxy

### Documentation
- open the features page with a map of the window and what you can do in each part
- 英語の docs を docs/ 直下に置き、CONTRIBUTING・行動規範・セキュリティポリシーを .github/ に移す
- add a tour of the features with parts of the screenshot
- show a Japanese screenshot in the Japanese README
- show a screenshot at the top of the README
- add the Contributor Covenant as the code of conduct
- call Worktabs an early preview instead of a prototype
- quote the English UI labels in the English documents
- ドキュメントを言語ごとのフォルダに分け、決まりを英語にする
- 公開に向けて、ドキュメントの英語版を正本にし、セキュリティの窓口と issue・PR のテンプレートを足す

### Chores
- name the wrapper's environment variables WORKTABS_*
- point the repository at worktabs/worktabs, and drop the links into the old history
- write the CHANGELOG headings, release notes, and issue templates in English
- セッション開始のフックで npm ci を使い、ロックファイルを書き換えない

## [0.3.1] - 2026-10-04

### Features
- サイドバーのツリーを字下げし、GitHub のボタンをリポジトリのアイコンに乗せたときに出す

### Documentation
- Actions の予算を使い切っている間は、リリースを手元でビルドして配ると書く

## [0.3.0] - 2026-10-04

### Features
- 自分と org の GitHub のリポジトリのうち、クローンしていないものをサイドバーに出し、行からクローンする
- 初めて開いたタブで、右のチャット欄の幅を primary に合わせる（primary は 2:1）
- リポジトリの行から、その worktree のタブをすべて閉じる
- リポジトリの行にリモートのプロバイダーを出し、GitHub でないリモートと SSH の別名を正しく扱う
- リポジトリの行に、GitHub での公開範囲（private・internal）をアイコンで出す
- issue・PR・やることから作った worktree の最初の会話を、右のチャット欄で開く
- 新しく開いたタブでも、右のサイドバーに Claude Code のチャット欄を出す
- 閉じたタブのポートを覚えて、開き直したときに VS Code の画面の状態を戻す
- worktree の削除の確認に、PR がマージ済みかを出す
- worktree の行に、main へのマージとリリースの CI の結果も出す
- macOS で動かし、Release に mac の zip も出す

### Bug fixes
- mac で Finder から起動しても、ghq のリポジトリを一覧に出す
- ほかのウィンドウが前にあるときも、サイドバーの行を 1 回押せば切り替わる
- worktree を削除したら、そのリポジトリの primary に移る
- mac で「エクスプローラー」の文言を「Finder」にする

### Documentation
- README に、いつもの VS Code を使いたい人向けであることと、クラウドのセッションとの併用を書く
- MIT ライセンスにして、LICENSE と第三者ソフトウェアの表示を置く
- README を英語にし、日本語版を README.ja.md に分ける
- research/ を英語の docs/research.md に要約する
- クラウドのセッションを使わない理由を README に書く

### CI
- Actions の予算を使い切ったので、Windows と macOS の CI を一時的に止める
- macOS の CI を毎晩 1 回にし、ドキュメントだけの変更では CI を動かさない
- macOS の CI を PR で動かさず、ジョブに 10 分の上限を付ける

## [0.2.0] - 2026-10-01

### Features
- 会話の行に、今の状態になってからの経過時間を出す
- PR の番号から、レビュー用の worktree を作る
- worktree の行に、そのブランチの PR の状態と CI の結果を出す

## [0.1.0] - 2026-10-01

### CI
- タグからインストーラーと zip を作り、GitHub Releases に出す

### Other
- worktree の行のゴミ箱を、× のあった右端に出す
- worktree の行のゴミ箱のボタンから削除し、削除で消えるものを確認に足す
- サイドバーのリポジトリの行から、開いているタブの数を消す
- サイドバーの幅をドラッグで変え、次の起動で戻す
- 同じリポジトリの worktree のタブで、VS Code の設定を共有する
- 実機の確認を後に回すときに別の issue を作る決まりをやめる
- 右のパネルの背後の会話を、行のクリックで切り替え、アーカイブで一覧から外す
- 通知をクリックしたら、時間が経っていてもその会話のタブに移る
- GitHub の issue ややることから worktree を作り、ブランチ名を Claude に考えさせる
- worktree の新しいブランチを、既定のブランチから作る
- リポジトリ一覧を前回の分ですぐに出し、WSL のディストリを自動で拾う
- 確認や警告のダイアログを、VS Code のテーマの色で出す
- README に Worktabs を作った理由を書き、詳しい説明を docs/ に分ける
- サイドバーの節の見出しと使用量の文言を直す
- サイドバーの上端を、会話の数のバッジと、更新・追加・そのほかのボタンに分ける
- サイドバーの色を、前に出ているタブの VS Code のテーマに合わせる
- サイドバーの WSL の印を、ダークテーマでも見えるようにする
- Claude の使用量（5 時間の枠・週の枠）をサイドバーに出す
- WSL の中のリポジトリをタブで開く（code-server と claude を WSL の中で動かす）
- git でないフォルダ（ghq の SVN チェックアウトなど）を、ふつうのフォルダとして開く
- worktree を作るとき、.worktreeinclude に書いた gitignore されたファイルをコピーする
- 調査の記録から Orca を消す
- Orca からリポジトリ一覧を読む機能を取り除く
- CI の actions を、Node 24 で動く v5 にする
- クラウドの環境でも確かめられるように、単体テストと CI を足す
- 長い題名の会話を前に出すとき右のパネルが出るのと、インストーラーが高 DPI でぼやけるのを直す
- 右のパネルとエディタのタブの Claude のチャット欄が、フォーカスを奪い合って操作できなくなるのを直す
- サイドバーのツリーを「開いている」と「ほかのリポジトリ」に分け、GitHub のボタンをリポジトリの下に移す
- ウィンドウの大きさ・位置・最大化を保存して、次の起動で戻す
- 開発用の制御ポートが使えないときに、エラーのダイアログを出さずに続ける
- サイドバーから worktree を追加・削除する
- ビルドのたびに動作を確かめてから、普段使いの Worktabs に移せるようにする
- サイドバーを、リポジトリ → worktree → 会話の 1 つのツリーにする
- エクスプローラーで開くとき、開いているエクスプローラーのウィンドウに新しいタブとして開く
- サイドバーのタブの下に、Claude の会話ごとの行を出す
- インストーラーなしでも使えるように、npm run dist で zip も作る
- 開発用の起動では別のアプリ ID を使い、インストール版の通知が「Electron」になるのを直す
- 起動時に code-server と拡張の新しい版を確認して、サイドバーから更新する
- サイドバーのボタンから GitHub のリポジトリ・Issues・PR・Actions を開く
- 移動に合わせてパスとリンクを直し、「次にやること」を issue に移す
- アプリ（app/）をリポジトリのトップに上げる
- 調査と検証を research/ にまとめる
- 新しい会話を Auto で始め、VS Code を日本語にし、右クリックに「エクスプローラーで表示する」を足す
- タブを左のサイドバーに移し、リポジトリ一覧を Orca と ghq から作る
- インストーラーの作成と、アプリからの設定編集に対応
- クッキー認証、内蔵 AI 機能の無効化、未保存編集の保護、code-server の自動取得
- worktabs の調査、段階0の検証、段階1のプロトタイプ


