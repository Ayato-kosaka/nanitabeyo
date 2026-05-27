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
