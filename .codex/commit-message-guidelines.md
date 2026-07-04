# Commit Message Guidelines

When writing a commit message, always include the related issue number, such as `#782`, if the work is tied to an issue.
Commit messages must be written in Japanese.

Use a format like this:

```text
#782 fix: languageTag=ja が来たときに dish_category_localized_text を ja-JP として検索してしまう不具合を修正
[修正内容の概要を簡潔に]
```

Rules:
- Put the issue number in the first line.
- Keep the first line focused on the issue, the bug, and the affected area.
- Put the implementation summary on the second line in one short phrase.
- Write both lines in Japanese.
- Make the message understandable when reading history later: briefly include why the change was needed and what was changed.
- Prefer concrete cause/effect wording over vague phrasing such as "fix bug" or "adjust behavior".

## Clarity Requirements

コミットメッセージでは、修正理由と修正内容を明確に分けて書く。

推奨構成:

```text
#802 fix: AndroidでDishMediaの背景画像における一時的な取得失敗をretryする
#802 対応の結果、Android において店メディア背景画像が表示されない場合がある問題を検知。
`useDishMediaBackgroundImageResources.ts` に、`Image.loadAsync` の一時失敗に対する自動 retry を追加
Image.loadAsyncのretryと全件preloadのTODOを追加
```

Rules:
- 1行目は issue 番号、種別、対象領域、最終的に直す不具合を具体的に書く。
- 2行目以降で、なぜ追加対応が必要だったのかを短く説明する。
- どのファイルまたは処理に何を追加・変更したのかを明記する。
- 「何をしたか」だけでなく「なぜ必要だったか」が履歴から読めるようにする。
