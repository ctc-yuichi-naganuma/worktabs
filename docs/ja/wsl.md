# WSL のリポジトリ

[English](../wsl.md) | **日本語**

WSL の中のリポジトリ（`\\wsl.localhost\<ディストリ名>\...`）も、タブで開けます。VS Code の WSL 拡張と同じ形で、アプリの画面は Windows のまま、code-server（Linux 版）を WSL の中で動かします。WSL の中にも git が要ります。

## 開き方

- WSL の ghq で管理しているなら、設定に何も書かなくても一覧に出ます。入っているディストリ（`wsl.exe -l -q`。WSL を起動しません）ごとに、その中の `ghq list` を読みます。ghq がないディストリと、Docker Desktop のディストリからは、何も出ません。
  - 見るディストリを決めるときは、設定の `repoSources` に、`"wsl"` の代わりに `"wsl:<ディストリ名>"` を書きます（例: `["ghq", "wsl:Ubuntu-24.04"]`）。
  - 設定ファイルに `repoSources` を書いていると、既定の `["ghq", "wsl"]` は使いません。前の版で「リポジトリを追加…」をすると、`"repoSources": ["ghq"]` が書き込まれています。WSL のリポジトリを出すには、`"wsl"` を足すか、この行を消します。
  - 起動したときは、前回リポジトリがあったディストリでだけ、エージェント（[architecture.md](architecture.md)）を立ち上げます。ほかのディストリは、一覧を読み直すときに見るだけです。
  - WSL が入っていない PC では、`"wsl"` は何もしません（エラーも出さず、起動も遅れません）。
- 「リポジトリを追加…」「フォルダを開く…」で、エクスプローラーの「Linux」から WSL の中のフォルダを選んでも構いません。

サイドバーでは、WSL のリポジトリの行に「WSL」と出ます（マウスを乗せるとディストリ名が出ます）。Windows のリポジトリには出ません。

## クローンする

サイドバーの「クローンしていないリポジトリ」（[usage.md](usage.md#クローンしていないリポジトリ)）から、WSL の中にもクローンできます。

- クローンのボタンを押すと、クローン先を「Windows」「WSL: <ディストリ名>」から選ぶメニューが出ます。
  - WSL の候補は、`repoSources` で読んでいるディストリのうち、ghq が入っているか、一覧にリポジトリがあるものです。ghq が入っているかは、一覧を読み直したときに分かります（起動して読み終わるまでは、一覧にリポジトリがあるディストリだけです）。
  - 候補が Windows だけなら、メニューは出ずに、すぐ Windows にクローンします。
- ghq が入っていれば、その中で `ghq get` を動かします。ghq は、シェルの起動ファイルで PATH に入るもの（`~/go/bin` など）でも構いません。
  - `repoSources` がそのディストリを読んでいないときは、クローンしたフォルダを設定の `repos` に足します。
- ghq がなければ、クローン先のダイアログが出て、WSL の中の git で `git clone` します。候補は、そのディストリのリポジトリの場所から求めます。欄には `\\wsl.localhost\<ディストリ名>\...` のパスが入り、その下に Linux のパスが出ます。
- https か SSH かは、WSL の中の gh の設定（`gh config get git_protocol`）に合わせます。gh がなければ https です。
- 認証は、WSL の中の git の設定を使います。Windows の gh のサインインや Git Credential Manager とは別なので、private のリポジトリは、WSL の中で `gh auth login` と `gh auth setup-git` をしておくか、WSL の git から Windows の Git Credential Manager を使うように設定します。
- 一覧に出すリポジトリ自体は、Windows の gh に聞きます（WSL の中の gh には聞きません）。クローン済みかは、Windows と WSL のどちらのリポジトリとも比べます。

## タブの中で WSL で動くもの

タブでは、画面以外がすべて WSL の中で動きます。

- VS Code のターミナルは WSL のシェルで開き、作業フォルダは worktree の Linux のパスです。
- Claude Code 拡張は Linux 版を入れ、claude も WSL の中で動きます。claude の Bash ツール、hooks のコマンド、MCP サーバーも WSL の中です。会話の履歴と設定は WSL の `~/.claude` です。
- ソース管理の git、タスク、言語サーバーなどの拡張も WSL の中で動きます。
- PATH は WSL のターミナルと同じです。code-server は、拡張ホストのためにログインシェル（`$SHELL -i -l`）から環境変数を読みます（VS Code のサーバーと同じ）。nvm で入れた node なども見えます。
- ターミナルの `code <ファイル>` は、そのタブで開きます。`code <フォルダ>` は、新しいタブで開きます。

サイドバーの worktree の追加・削除、ブランチ名、GitHub のボタン（`git remote` と `gh`）も、WSL の中の git・gh で動きます。

タブのメニューの「Linux のパスをコピー」で、WSL の中のパス（`/home/...`）をコピーできます。「パスをコピー」は `\\wsl.localhost\...` です。

VS Code の設定は、Windows のリポジトリと同じく、同じリポジトリの worktree のタブで共有します（[usage.md](usage.md#vs-code-の設定)）。Windows のリポジトリのタブとは共有しません。共有の内容は Windows のデータフォルダ（`repos\`）に置き、各タブの WSL の `~/.worktabs/instances/<タブID>/User` に書きます。

## 初めて使うとき

- 初めて WSL のタブを開くときに、code-server の Linux 版（約 210 MB）を Windows でダウンロードして、WSL の `~/.worktabs/code-server` に展開します。拡張も、Windows のタブと同じ版を WSL の `~/.worktabs/extensions` に入れます。
- claude のログインは、WSL の `~/.claude` で別に必要です（WSL のターミナルで `claude` を一度起動してログインします）。
- WSL が止まっているときは、最初のタブの起動に数秒余計にかかります。

- WSL のタブの Claude からは、まだ使用量を受け取りません（[usage.md](usage.md#claude-の使用量)）。

WSL で確かめた環境は [limitations.md](limitations.md) に、仕組みは [architecture.md](architecture.md#wslwindows) にあります。
