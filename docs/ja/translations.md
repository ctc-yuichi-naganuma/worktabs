# 翻訳

[English](../translations.md) | **日本語**

英語のドキュメントと UI の文言が原文です。日本語版は翻訳で、遅れていても構いません。必要になったときに追いつかせます。頼まれていないページは翻訳しません。

| 英語（原文） | 日本語 |
|---|---|
| `README.md` | `README.ja.md` |
| `docs/<page>.md` | `docs/ja/<page>.md` |
| UI 文字列: `src/` の中で `t()` に渡す英語 | `src/i18n/ja.json`。英語をキーにする |

`docs/research.md` は英語だけです。.github/ のコントリビューター向けドキュメント（`CONTRIBUTING.md`・`CODE_OF_CONDUCT.md`・`SECURITY.md`）も英語だけです。翻訳しません。

## 手順

1. `npm run translations` を実行します。遅れている日本語ページと、その日本語ページが最後にコミットされてからの英語の変更を示す `git diff` が出ます。引数でページを指定されたときは、そのページだけ更新します。
2. 遅れているページでは、その `git diff` を見て、変わったところだけを日本語ページに反映します。ほかの場所は、言い換えたくてもそのままにします。日本語では何もいらない変更（typo、英語の UI ラベルが日本語ページではすでに日本語になっている場合など）もあります。`Translation: not needed` と書いたコミットの英語変更は、`npm run translations` がすでに除外しています。
3. 日本語ページがないときは、英語ページ全体を翻訳します。
4. もう一度 `npm run translations` を実行します。更新したページはコミットするまで `behind` と出ます。そのページに `headings` の行が残っていないことを確認します。
5. 日本語ページをコミットします（`docs: ...`）。コミットが「ここまで追いついた」という印になるので、完全に翻訳したページだけをコミットします。

## UI 文字列

`npm run translations` は、日本語がない UI 文字列（`untranslated`、使われている場所付き）、もう使われていない日本語（`unused`）、英語と日本語でプレースホルダーが違うもの（`placeholders`）も出します。

1. 未翻訳の文字列は、それが使われている場所を読んで、メニュー項目、ボタン、ダイアログのメッセージなどのどれかを確認します。
2. `src/i18n/ja.json` に `"English": "Japanese"` を追加します。近くにある、同じあたりで使う文字列のそばに置きます。`{name}` のようなプレースホルダーは保ちます。
3. 未使用の項目は、たいてい英語が変わった文字列の古い訳です。意味が同じならその日本語を新しい英語に使い、古い項目を消します。
4. `npm test`（プレースホルダーを確かめます）と `npm run translations` を実行します。UI の変更に合うなら `feat:` や `fix:`、翻訳だけなら `chore: translate ...` でコミットします。

## 日本語の書き方

- 既存のページと同じように、短いです・ますで書きます。UI では、メッセージは `休止中です。` のようにです・ますにし、メニュー項目、ボタン、ラベルは `worktree を削除…`、`閉じる` のように短い句にします。
- 日本語と Latin 文字・数字の間には半角スペースを入れます（`worktree を選ぶと`、`12 分`）。
- 日本語の文では全角の括弧を使います（`（タブの切り替えなど）`）。
- 見出しは英語ページと数、レベル、順番をそろえ、見出しの文言だけを翻訳します。
- UI ラベルは、日本語 UI に出るとおりに「」で囲みます。英語ページでは英語のラベルを引用しています。
- 日本語ページからは日本語ページにリンクします。`docs/ja/`、`README.ja.md` です。英語だけのページへリンクするときは英語のパス（`../research.md`、`../../.github/CONTRIBUTING.md`）を使い、英語であること（`（英語）`）を書きます。
- 見出しへのリンクは、日本語見出しのアンカーを使います（`usage.md#サイドバー`）。英語のアンカーにはしません。
- コード、コマンド、パス、設定キー、URL はそのままにします。コードブロック内のコメントは、既存の日本語ページが訳しているときだけ訳します。

## 用語

既存の日本語ページで使っている用語を使います。新しい言葉を選ぶ前に、`docs/ja/` を `rg` で探します。

| English | Japanese |
|---|---|
| worktree, main worktree | worktree, メインの worktree |
| repository | リポジトリ |
| tab | タブ |
| sidebar | サイドバー |
| right side bar (of VS Code) | 右のサイドバー |
| chat panel | チャット欄 |
| conversation | 会話 |
| turn | ターン |
| approval, waiting for approval | 承認, 承認待ち |
| suspend, suspended | 休止する, 休止中 |
| badge | バッジ |
| usage (of the Claude limits) | 使用量 |
| extension | 拡張 |
| language pack | 言語パック |
| settings file | 設定ファイル |
| data folder | データフォルダ |
| issue, pull request | issue, PR |
