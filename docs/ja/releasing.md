# リリース

[English](../releasing.md) | **日本語**

`npm version` で版を上げてタグを付け、push すると、GitHub Actions（`.github/workflows/release.yml`）がそのコミットから Windows のインストーラーと zip、macOS の zip を作り、GitHub Releases に出します。誰がどのコードから作ったものかが分かるように、配るものはローカルでは作りません。

ただし、いまは Actions の予算を使い切っているので、タグを push せずに、配るものを手元で作っています（下記「[いまは手元でビルドして配る](#いまは手元でビルドして配る)」）。

コミットの接頭辞の決まりは [CONTRIBUTING.md](../../.github/CONTRIBUTING.md)（英語）にあります。リリースノートは、その接頭辞から作ります。

## 版の付け方

- [SemVer](https://semver.org/lang/ja/) で付けます。`0.x` の間は互換性を保証しません（設定ファイルやデータフォルダの中身が変わることがあります）。
- どこを上げるかは、そのリリースに入るコミットの接頭辞で決めます（[CONTRIBUTING.md](../../.github/CONTRIBUTING.md)（英語）の「1. Prefixes」）。`feat:` があれば minor、`fix:` などだけなら patch です。
- 版を書くのは `package.json` の `version` だけです。アプリが名乗る版、インストーラーと zip（Windows と macOS）の名前、タグは、ここからそろいます。
- 補助拡張の版（`helper-extension/package.json`）はこれとは別で、補助拡張の中身を変えたときに上げます。アプリは補助拡張の版で、各タブの VS Code に入れ直すかを決めるためです。

## リリースする

1. main を最新にします。
   ```sh
   git switch main
   git pull
   npm ci
   npm run changelog   # （任意）まだリリースしていない分を見る
   npm run pack        # （任意）main のビルドを npm run try で確かめる（install.md の「自分でビルドした Worktabs を更新する」）
   ```
2. 版を上げます。
   ```sh
   npm version minor   # 0.1.0 → 0.2.0。修正だけなら patch
   ```
   `npm version` は、次のことを続けて行います。作業ツリーに変更が残っていると止まります。
   - `package.json` と `package-lock.json` の `version` を上げる
   - `CHANGELOG.md` を git-cliff で作り直す（`scripts/changelog.js`。設定は `cliff.toml`）
   - `chore(release): v0.2.0` でコミットし（メッセージは `.npmrc`）、`v0.2.0` のタグを付ける
3. push します。main に直接 push するのは、このときだけです。
   ```sh
   git push --follow-tags
   ```
4. Actions の「Release」が終わると、Releases に出ます。タグを push したらすぐに配られるので、確かめることは手順 1 で済ませておきます。

- リポジトリは公開のときに 1 つのコミットから始め直したので、CHANGELOG とタグもそこから始まります。0.3.1 までの版は公開していません。
- `CHANGELOG.md` は、リリースのたびにすべての履歴から作り直すので、手で直しても次のリリースで消えます。直すのは、コミットのメッセージ（squash merge では PR のタイトル）の方です。

## いまは手元でビルドして配る

2026 年 10 月に Actions の予算を使い切ったので、0.3.0 からは、タグを push せずに、Windows の zip とインストーラーを手元で作って渡しています。予算が戻ったら、上の「リリースする」に戻します。

1. main を最新にし（「リリースする」の手順 1）、`npm run check` と `npm test` を通します。Windows の CI を止めているので、手元で確かめてから作ります。
2. `npm version minor`（修正だけなら `patch`）で版を上げます。リリースのコミットとタグは、いつもどおり作られます。
3. main だけを push します。ほかの端末でも、いまの版が分かるようにするためです。タグは push しません。push すると Release のワークフローが動くためです。
   ```sh
   git push origin main
   ```
   - `package.json` が変わるので、main への push で Ubuntu の CI が 1 回動きます。
4. 作ります。
   ```sh
   npm run pack          # dist/win-unpacked
   npm run dist:packed   # dist/Worktabs-<版>-win.zip と dist/Worktabs-<版>-setup.exe
   ```
   - 自分の Worktabs は、`dist\win-unpacked` から `update-worktabs.cmd` で更新します（[install.md](install.md#自分でビルドした-worktabs-を更新する)）。配るものと同じ中身です。
5. 渡すときは、SHA-256 とリリースノートを添えます。
   ```powershell
   Get-FileHash dist\Worktabs-0.3.0-win.zip
   node scripts/release-notes.js v0.3.0
   ```

- タグは、版を上げた端末にだけあります。次の版も同じ端末で上げます。git-cliff はタグで CHANGELOG の版を区切るので、タグのない端末で `npm version` を実行すると、前の版のコミットも新しい版にまとめて入ります。
- macOS の zip は作っていません。要るときは、mac の実機で `npm run dist:mac` を実行します。
- Windows のファイルは署名していないので、受け取った人が初めて起動すると、SmartScreen の警告が出ます（下記「署名」）。
- 予算が戻ったら、手元のタグを push すると、Release のワークフローがその版を Releases に出します。手元で配ったものと同じコミットから作り直すので、中身は同じですが、SHA-256 は変わります。タグごとに Release が動くので、出すのは最新の版だけでも構いません。

## Release のワークフローがすること

`v` で始まるタグの push で動きます。

- タグと `package.json` の版が違うときは、ビルドせずに失敗します。アプリは `package.json` の版を名乗るためです。
- リリースノートは、タグのコミットの `CHANGELOG.md` から、その版の節を取り出したものです（`scripts/release-notes.js`）。ワークフローでは git-cliff を実行しないので、CHANGELOG とリリースノートは食い違いません。節がないときは、ビルドの前に失敗します。末尾に、どのファイルを取ればいいかの表を足します。
- ビルドは、Windows（`npm run dist`）と macOS（`npm run dist:mac`）の 2 つのジョブで並べて行います。どちらも、ビルドの前に `npm run check` と `npm test` を実行します。片方が失敗すると、もう片方も止め、リリースは作りません。
- できたファイルは、最後のジョブが 1 つにまとめて、1 つのリリースに出します。
- `SHA256SUMS.txt`（インストーラーと 2 つの zip の SHA-256）も一緒に出します。リポジトリが公開なら、Artifact attestation（どのコミットから作ったかの証明）も付けます。非公開のリポジトリでは使えないので飛ばします。
- `-` を含む版（`0.2.0-rc.1` など）は、プレリリースとして出します。

リリースノートは、手元でも同じものを見られます。

```sh
node scripts/release-notes.js v0.2.0
```

ワークフローはタグでしか動きません。`scripts/release-notes.js` と `cliff.toml` は、`npm test`（`test/release-notes.test.js`）で確かめます。

## 失敗したとき

- ワークフローが途中で失敗したときは、原因を取り除いてから、Actions で Re-run します。gh はファイルをすべて上げ終えてからリリースを公開し、上げるのに失敗したら途中のリリースを消すので、そのまま作り直せます。
- ビルドやテストが失敗して、コードを直す必要があるときは、タグを消し、直した main で同じ版をもう一度付けます。
  ```sh
  git push origin :refs/tags/v0.2.0
  git tag -d v0.2.0
  # 直す PR を main にマージしてから
  git switch main && git pull
  npm version 0.2.0 --allow-same-version
  git push --follow-tags
  ```
- 出したあとで問題が見つかったときは、直して次の patch を出します。出した版のタグは付け直しません。配ったものと、タグのコードが食い違うためです。

## 署名

リリースノートで Codex への対応を完了と書く前に、[検証の表](codex-verification.md)を、出すアプリと拡張の版で更新します。確かめた環境と、残っている制限を書きます。サインインしたプラットフォームでの確認が残っている間は、その表のリリースノートの範囲に沿って書きます。

インストーラーと `Worktabs.exe` は署名していないので、ダウンロードしたものは初回の起動で SmartScreen の警告が出ます。macOS の `Worktabs.app` は、Electron が通知を出せるように、アドホック署名をしています。Developer ID の署名も公証もしていないので、ダウンロードしたものは、やはり Gatekeeper に止められます。起動する前に `xattr` でダウンロードの印を外します（[install.md](install.md#macos-の-zip)）。
