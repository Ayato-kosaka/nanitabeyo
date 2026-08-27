# GitHub Copilot 向け指示

このリポジトリの規約は人間・エージェント共通で [CONTRIBUTING.md](../CONTRIBUTING.md) に集約してある。
**まずそれを読むこと。** ここには Copilot 固有の注意だけを書く。

## 正とする場所

| 知りたいこと                                 | 見る場所                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| セットアップ、技術スタック、ディレクトリ構成 | [README.md](../README.md)                                                     |
| コマンド、CI が回す検査、i18n、PR ルール     | [CONTRIBUTING.md](../CONTRIBUTING.md)                                         |
| コードコメントの書式と種別                   | [.codex/commentary-policy.md](../.codex/commentary-policy.md)                 |
| コミットメッセージ                           | [.codex/commit-message-guidelines.md](../.codex/commit-message-guidelines.md) |
| ドキュメントを作ってよいかの判断             | [docs/README.md](../docs/README.md)                                           |
| UI の見た目・配色・スクリーンショット検証    | [docs/design-guidelines.md](../docs/design-guidelines.md)                     |

**これらの内容をこのファイルへ複製しないこと。** 二重管理になり、
過去に「lint は壊れている」等の実態と真逆の記述が長期間残る事故が起きている。

## 生成前に守ること

- **UI 文字列を直書きしない。** `app-expo/locales/` の 8 言語すべてにキーを足す
- **コメントは日本語で `#<Issue番号> 【種別】` 形式。** 種別は `設計 / バグ / 性能 / 互換性 / 運用`
- **設計解説の md ファイルを新規作成しない。** 設計判断はコードコメント、経緯は PR 本文へ
- 既存ファイルのスタイル（命名・import 順・空行）に厳密に追従する
- 生成物（`shared/prisma/**`、`shared/supabase/database.types.ts` など）へ手書きコメントを足さない

## 環境変数

`api/` は起動時に zod で検証し、**必須変数が 1 つでも欠けると起動しない**。
必須変数の一覧は `api/src/core/config/env.ts` が唯一の正。
テンプレートをこのファイルに書き写すと必ず陳腐化するので、コードを読むこと。
