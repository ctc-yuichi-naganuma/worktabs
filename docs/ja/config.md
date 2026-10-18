# 設定とデータフォルダ

[English](../config.md) | **日本語**

## 設定ファイル

| 起動のしかた | 設定ファイル |
|---|---|
| インストール版・zip 版（Windows） | `%APPDATA%\Worktabs\config.json` |
| Worktabs.app（macOS） | `~/Library/Application Support/Worktabs/config.json` |
| `npm run try`（[install.md](install.md#自分でビルドした-worktabs-を更新する)） | `%LOCALAPPDATA%\Worktabs-try\config.json` |
| `npm start`（[development.md](development.md)） | リポジトリの `config.local.json` |

- 環境変数 `WORKTABS_CONFIG` があれば、どの起動のしかたでも、そのパスを使います。
- サイドバーの上端の「＋」にある「リポジトリを追加…」と、「…」にある「設定ファイルを開く」から編集できます。
- 書いていない項目は既定値になります。書き方の例は [config.example.json](../../config.example.json) です。

| キー | 意味 |
|---|---|
| `repoSources` | サイドバーのリポジトリ一覧の取得元。`"ghq"`（`ghq list`）、`"wsl"`（入っている WSL のディストリごとに、その中の `ghq list`）、`"wsl:<ディストリ名>"`（そのディストリの中の `ghq list`。例: `"wsl:Ubuntu-24.04"`）。既定は `["ghq", "wsl"]`。WSL が入っていなければ、`"wsl"` は何も出さない。Windows 以外では、`"wsl"` で始まる取得元は読みにいかない |
| `repos` | 手で追加したリポジトリ（「リポジトリを追加…」で増える） |
| `githubHosts` | GitHub とみなすホストを足す（例: `["git.example.co.jp"]`）。github.com、`github.` で始まるホスト、`<テナント>.ghe.com`、gh がサインインしているホストは、書かなくても GitHub とみなす。gh を使わない GitHub Enterprise Server のためのもの（[architecture.md](architecture.md#github-のボタン)） |
| `unclonedRepos` | サイドバーに「クローンしていないリポジトリ」を出す（既定 `true`。[usage.md](usage.md#クローンしていないリポジトリ)）。`false` なら、gh にも聞かない |
| `hiddenGithubOwners` | 「クローンしていないリポジトリ」に出さない owner。`"<owner>"`（どのホストでも）か `"<ホスト>/<owner>"`（例: `["big-org", "ghe.example.com/team"]`）。大文字小文字は区別しない。リポジトリの多い org を外すためのもの。owner の行の右クリックの「この owner を出さない」でも足せる |
| `cloneRoot` | ghq がないときに、最後にクローンした場所（ghq と同じ並びならその root、そうでなければ親のフォルダ）。アプリが書き込み、クローン先のダイアログはここから始める。WSL の場所なら、そのディストリにクローンするときだけ使う |
| `sidebarWidth` | サイドバーの既定の幅（ピクセル、既定 `260`）。サイドバーの右端をダブルクリックすると、この幅に戻る。右端をドラッグして変えた幅は `window.json` に残り、こちらより優先する（[usage.md](usage.md#幅)） |
| `codeServerDir` | 既存の code-server を使う場合に、展開したフォルダ（`lib/node.exe`、macOS では `lib/node` があるところ）を指定する。空ならデータフォルダの `code-server` に自動で取得する |
| `codeServerVersion` | 自動取得する code-server の版（既定 `4.139.1`。動作を確認した版）。サイドバーから更新すると、アプリが新しい版を書き込む。WSL にも同じ版の Linux 版を入れる |
| `wslCodeServerDir` | WSL のタブで、既存の code-server（Linux 版）を使う場合に、WSL の中の展開したフォルダを Linux のパスで指定する（`lib/node` があるところ）。空なら、WSL の中の `~/.worktabs/code-server` に自動で取得する |
| `updateCheck` | 起動時に、code-server と拡張の新しい版を GitHub と Open VSX に確認する（既定 `true`）。`false` でも、サイドバーの上端の「…」から手動で確認できる |
| `extensionsDir` | 全インスタンスで共有する拡張フォルダ。空ならデータフォルダの `extensions` |
| `extensions` | 拡張フォルダになければ Open VSX から入れる、追加の拡張の ID。インポートで入手元を固定した拡張は除く。言語パックは自動で加える（[extensions.md](extensions.md)） |
| `restrictExtensionGallery` | 組み込みの拡張ギャラリーを無効にする（既定 `true`）。拡張のインストールと更新は Worktabs が管理する。セキュリティのためのサンドボックスではない |
| `agents` | タブで開くエージェント。既定は `["claude"]`。Codex をインポートしたら、`["codex"]` か `["claude", "codex"]` にする。Claude は既定で Open VSX から入れる |
| `defaultAgent` | 複数のエージェントを有効にしているときに、新しいタブで開くエージェント（`"claude"` か `"codex"`） |
| `branchAgent` | ブランチ名を考えるエージェント（`"claude"`・`"codex"`、または `defaultAgent` に従う `"default"`） |
| `locale` | アプリと VS Code の表示言語（既定は空）。空なら OS の優先する言語に従う。そのうちアプリにある最初の言語（英語か日本語）、なければ英語で、VS Code も同じ言語になる。アプリ自身のメニュー・ダイアログ・メッセージは英語か日本語で、ほかの言語（`de`・`zh-cn` など）なら VS Code はその言語、アプリ自身は英語になる。VS Code に要る言語パックは自動で入れる |
| `permissionMode` | 新しい会話の初期権限モード（`auto`・`manual`・`acceptEdits`・`plan`）。既定は `auto`。空にすると Manual で始まる |
| `codexApprovalMode` | Codex の新しい会話の承認の初期設定。`"auto-review"`（既定）か `"manual"`。自動審査で **Approve for me** を選ぶのは、使っている拡張がそれを出していて、許しているときだけ |
| `pasteFallback` | `true` で、Ctrl+V をアプリが受けて Electron 経由で貼り付ける（実キーの Ctrl+V が効かない場合の回避策） |
| `idleSuspendMinutes` | 非アクティブで、作業中・承認待ち・未読がないタブを、この分数で自動休止する（`0` で無効） |
| `controlPort` | 開発用の制御ポート（[development.md](development.md)）。普段は設定しない |

設定のダイアログでは、「使うエージェント」にエージェントごとのチェックボックスがあります。1 つ以上のエージェントを有効にでき、少なくとも 1 つは有効のまま残ります。「新しいタブの既定エージェント」と「ブランチ名を考えるエージェント」の選択肢には、有効にしたエージェントだけが出ます。

Codex だけを使う例は [config.codex.example.json](../../config.codex.example.json) です。先に対応する Codex 拡張をインポートし、Codex を有効にして、そのチャット欄でサインインします。両方のエージェントを使うには、`agents` を `["claude", "codex"]` にし、新しいタブで開くエージェントを `defaultAgent` で、ブランチ名を考えるエージェントを `branchAgent` で選びます。保存して起動し直しても、既存のタブと会話の行は、それぞれのエージェントのままです。WSL では、対応する Linux 向けの拡張と、WSL の中でのサインインが別に要ります。[検証の表](codex-verification.md)は、自動テストで確かめた範囲と、実際の拡張で確かめた結果を分けて載せています。

「設定 > 拡張」では、拡張の入手元・版・インポート・更新を扱います。Claude の Open VSX からの更新は、Worktabs が管理します。デスクトップの VS Code と VSIX からインポートした拡張は、ときどき入手元で更新して、インポートし直す必要があります。Worktabs は、これらを Microsoft Marketplace から取得しません（[extensions.md](extensions.md)）。

`permissionMode` が要る理由は [limitations.md](limitations.md) にあります。この設定は Claude Code だけに効きます。Codex の承認とサンドボックスは Codex の別の設定なので、Worktabs は同じ選択肢としては出しません。

「設定 > 一般 > Codex の新しい会話の承認」で、Codex の承認の扱いを Claude とは別に保存できます。この設定は、すべての Worktabs のタブで、新しい空の Codex の入力欄に効きます。起動し直したあとや、タブを開き直したあとも同じです。入力欄を開いている間に設定を変えたときは、次の新しい会話から効きます。再開した会話は、選んであったモードのままです。Full Access とカスタムのプロファイルもそのまま残し、入力欄を操作したあとは既定を当てはめません。

実際に効いているモードは、Codex の権限の切り替えに出ます。拡張が古い、その機能を使えない、管理ポリシーで制限されている、権限の選択メニューを見分けられない、のどれかのときは、拡張の今のモード（ふつうは **Ask for approval**）のままです。古い app-server には、対応していない審査の値を渡しません。拡張の更新、インポートし直し、前の版に戻したときを含め、webview が起動し直すと、使っている選択メニューを確かめ直します。ローカルのタブと WSL のタブは、それぞれの環境で使っている拡張と実行環境を使います。

Worktabs は、拡張自身の承認の選択肢を選ぶだけです。Codex 全体の設定を変えたり、別の CLI を入れたり、承認の求めに自分で応じたり、Full Access を選んだりはしません。[自動審査](https://learn.chatgpt.com/docs/sandboxing/auto-review)はサンドボックスを保ったまま、対象になる求めを審査役に回します。拒否されたときやエラーのときは、求めた操作は行われません。

Codex を有効にすると、Worktabs は、各タブの VS Code で Codex のエディタの設定もいくつか管理します。Codex のパネルは Worktabs が開くので、`chatgpt.openOnStartup` を `false` にします。`chatgpt.localeOverride` は VS Code の表示言語にします。英語のときは、この設定を消します。

`chatgpt.runCodexInWindowsSubsystemForLinux` も `false` にします。Windows で動かすか WSL で動かすかは、Worktabs が、Windows のタブを開くか WSL のタブを開くかで決めます。Codex 拡張が Windows のタブを WSL に振り向けることはさせません。

Worktabs は、Codex の `config.toml` を書きません。Codex のモデル、承認のポリシー、サンドボックスのモード、MCP サーバー、パーソナライズ、ログインは、Codex の側にあります。こうして、Claude Code の権限モードと、Codex 自身の承認とサンドボックスのしくみを混ぜないようにしています。

ブランチ名を考えるときは、選んだエージェントの、Worktabs で使っている拡張に付属する実行ファイルを使います。どちらのエージェントでも、`PATH` に別の `codex` や `claude` は要りません。Claude は、有効にしてタブを開くと、Open VSX の拡張が入ります。Codex は、「設定 > 拡張」で、このコンピューター向けの拡張をインポートします。拡張の更新、インポートし直し、前の版に戻したときは、そのあとのブランチ名を考えるときに使う実行ファイルも入れ替わります（[extensions.md](extensions.md)）。

WSL のリポジトリでは、そのリポジトリのディストリの `~/.worktabs/extensions` に入れた Linux 向けの拡張を使います。Codex は、対応する Linux 向けの Codex 拡張をインポートし、そのディストリでタブを開くと入ります。Claude は、そこで Linux 向けの Open VSX の拡張を使います。WSL でブランチ名を考えるときは、Windows の実行ファイルも、Windows でログインした認証情報も使いません。

worktree の追加のダイアログは、拡張のファイルがないときの直し方と、認証がないか期限が切れているときのサインインのしかたを示します。サインインは、ローカルの Worktabs のタブか、対応する WSL のディストリのタブで、そのエージェントのチャット欄から行います。そのほかの理由で実行に失敗したときは、CLI のエラーメッセージをそのまま出します。起動時と設定の保存時に出す Codex のブランチ名の警告は、ローカルの拡張の実行ファイルを確かめます。ブランチ名を考えるときは、選んだリポジトリの環境を確かめます。

## データフォルダ

データフォルダは、Windows では `%APPDATA%\Worktabs`、macOS では `~/Library/Application Support/Worktabs` です。`npm run try` では `%LOCALAPPDATA%\Worktabs-try`、環境変数 `WORKTABS_DATA_DIR` があればそのフォルダです。主な中身は次のとおりです。

| 場所 | 中身 |
|---|---|
| `tabs.json` | 開いていたタブとそのポート（`tabs`）、閉じたタブのポート（`ports`。フォルダごと）、リポジトリごとの最後にタブを開いていた時刻（`repoUsed`）、リポジトリごとの primary の右のチャット欄の幅（`chatWidths`。ピクセル）。ポートを覚えておく理由と、忘れるときは [architecture.md](architecture.md#code-server)、チャット欄の幅は [architecture.md](architecture.md#右のチャット欄の幅) |
| `window.json` | ウィンドウの大きさ・位置・最大化と、ドラッグで変えたサイドバーの幅 |
| `repos.json` | 最後に読んだリポジトリの一覧（`repos`）、読んだ worktree の一覧（`worktrees`）、リポジトリごとのリモート（`remotes`。プロバイダー・GitHub の URL・公開範囲と、名前を変えた・owner を移したリポジトリの今の URL）、gh がサインインしているアカウントと、その org のリポジトリ（`owned`。このうちクローンしていないものを出す）。次の起動で、まずこれを出す |
| `theme.json` | 最後に合わせた VS Code のテーマの色 |
| `usage.json` | 最後に受け取った Claude の使用量 |
| `code-server\` | 自動で取得した code-server（今の版と、ひとつ前の版） |
| `extensions\` | 全タブで共有する拡張 |
| `extension-imports\` | インポートした拡張のスナップショット、その SHA-256 ハッシュ、プラットフォームごとの入手元の記録、元に戻すための 1 つ前のスナップショット |
| `instances\<タブID>\` | タブごとの code-server の `user-data-dir`。git のリポジトリのタブでは、`User\` の設定を下の `repos\` と同じ内容にそろえる |
| `repos\<リポジトリID>\` | リポジトリごとに、その worktree のタブで共有する VS Code の設定（`settings.json`・`keybindings.json`・`tasks.json`・`mcp.json`・`snippets\`・`prompts\`）。`repo.json` に、リポジトリのパスと、共有に加わったタブを書く。worktree を削除しても残る（[architecture.md](architecture.md#vs-code-の設定の共有)） |
| `bin\` | macOS だけ。claude のラッパー（`claude-wrap` と `mac-claude-wrap.js`）。起動のたびに書き直す（[architecture.md](architecture.md#claude-のラッパー)） |
| `logs\` | ログ（下記） |

WSL のタブでは、code-server・拡張・エージェントを WSL の `~/.worktabs` に置きます（[wsl.md](wsl.md)）。

### ログ

ログは `logs\` にあります。

- `hooks.log`: Claude Code の hooks と、受け取った使用量
- `code-server-<タブID>.log`: タブごとの code-server。WSL のタブの code-server のログも、同じ名前で書きます
- `updates.log`: code-server と拡張の更新
- `repos.log`: リポジトリの一覧を読めなかった取得元と、その理由（WSL が入っていないなど）。公開範囲やアカウントのリポジトリを gh で読めなかったホストと、クローンに失敗したときの ghq・git の出力も
- `settings.log`: VS Code の設定をタブの間で共有できなかったときの理由
