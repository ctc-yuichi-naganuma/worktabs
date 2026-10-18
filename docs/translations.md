# Translations

**English** | [日本語](ja/translations.md)

The English documents and UI strings are the originals. The Japanese versions are translations that may lag behind; someone brings them up to date when they choose to. Do not translate a page nobody asked about.

| English (original) | Japanese |
|---|---|
| `README.md` | `README.ja.md` |
| `docs/<page>.md` | `docs/ja/<page>.md` |
| UI strings: the English passed to `t()` in `src/` | `src/i18n/ja.json`, keyed by the English |

`docs/research.md` is English only, and so are the documents for contributors in `.github/` (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`). Do not translate them.

## Steps

1. Run `npm run translations`. It lists each Japanese page that is behind, with the `git diff` that shows the English changes since the Japanese page was last committed. If arguments name pages, update only those.
2. For a page that is behind, run its `git diff` and translate only those changes into the Japanese page. Leave the rest of the Japanese page as it is, even where you would word it differently. Some of the changes may need nothing in Japanese (a typo, an English UI label the Japanese page has in Japanese); `npm run translations` already leaves out the commits that say `Translation: not needed`.
3. For a missing page, translate the whole English page.
4. Run `npm run translations` again. The pages you updated still show as behind until they are committed; check that no `headings` line remains for them.
5. Commit the Japanese pages (`docs: ...`). The commit is what marks them up to date, so commit only pages that are fully translated.

## UI strings

`npm run translations` also lists the UI strings with no Japanese (`untranslated`, with where the string is used), the Japanese no string uses any more (`unused`), and translations whose placeholders differ from their English (`placeholders`).

1. Read each untranslated string where it is used, to see what it is: a menu item, a button, a message in a dialog.
2. Add `"English": "Japanese"` to `src/i18n/ja.json`, next to the strings used around it. Keep each `{name}` placeholder.
3. An unused entry is usually the old translation of a string whose English changed. Reuse its Japanese for the new English if the meaning is the same, then remove the entry.
4. Run `npm test` (it checks the placeholders) and `npm run translations`. Commit with `feat:` or `fix:` as fits the UI change, or `chore: translate ...`.

## How to write the Japanese

- Use です・ます, in short sentences, like the existing pages. In the UI, messages use です・ます too (`休止中です。`), while menu items, buttons, and labels are short phrases without them (`worktree を削除…`, `閉じる`).
- Put a half-width space between Japanese and Latin letters or digits (`worktree を選ぶと`, `12 分`).
- Use full-width parentheses around Japanese text (`（タブの切り替えなど）`).
- Keep the headings the same in number, level, and order as the English page; translate their text.
- Quote UI labels with 「」, as the Japanese UI shows them. The English page quotes the English label.
- Japanese pages link to Japanese pages: `docs/ja/`, `README.ja.md`. Link to an English-only page with its English path (`../research.md`, `../../.github/CONTRIBUTING.md`), and say it is in English (`（英語）`).
- A link to a heading uses the anchor of the Japanese heading (`usage.md#サイドバー`), not the English one.
- Keep code, commands, paths, setting keys, and URLs as they are. Translate comments in code blocks only when the existing Japanese pages do.

## Terms

Use the terms the Japanese pages already use. Find others with `rg` over `docs/ja/` before choosing a new word.

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
