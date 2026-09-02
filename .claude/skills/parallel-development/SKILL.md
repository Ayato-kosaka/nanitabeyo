---
name: parallel-development
description: CSVまたはGitHubの親Issueから複数課題を読み取り、ローカルのClaudeをリーダーとして、汎用GitHub Actionsワーカーを動的なプロンプトとモデルで並列起動する。設計Sub-issueの作成、独立レビュー、人間との設計反復、Issue単位を基本とする実装PRの編成、PRレビュー、UI・APIテストエビデンス回収までを統括するときに使用する。
---

# Parallel Development

このスキルを使用するときは、次の文書を順番に読み、両方を適用する。

1. [`CORE.md`](./CORE.md) — 課題分割、設計、実装、レビュー、UIテスト、エビデンス公開を含む既存のオーケストレーション規約
2. [`API_TESTING.md`](./API_TESTING.md) — API変更をdevelopmentへ一時デプロイしてテスト・ログ調査し、必ずmainへ復旧する規約

API変更が含まれない場合でも`CORE.md`は必須である。API変更またはAPIの実環境検証が含まれる場合は、`CORE.md`に加えて`API_TESTING.md`を必ず適用する。

規約が競合する場合は、より安全で権限・環境を狭く制限する方を優先する。特にAPI検証ではproductionへのデプロイとproductionログdatasetへのアクセスを禁止し、developmentのmain復旧を完了条件とする。
