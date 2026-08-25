# 2026-08-13 PR Check を required にしない / ワーカーへ `workflows: write` を付与しない

並列開発（#1112）の実機確認のなかでオーナーが確定させた 2 つの決定。
**この 2 つはセットで、片方だけ覆すと成立しない。**

## 決定 1: `pr-check.yml` を required check にしない

**マージをブロックしたくない**というのがオーナーの判断。`pr-check.yml` は全 PR で走り続けるが、
赤でもマージできる状態を維持する。

再提案する場合は、「マージをブロックしない」という意向と両立する形（警告のみ、別の可視化など）で出すこと。
当時集めた材料（main にゲートが 1 つも無い、実行履歴で flake 0 件・真陽性 1 件、ruleset を消せば戻せる）は
**required 化を推す材料として集めたが採用されなかった**ものなので、そのまま再掲しても判断は変わらない。

## 決定 2: Claude Worker へ `workflows: write` を付与しない

ワーカーは `.github/workflows/` 配下へ push できない（GitHub App の権限不足でサーバ側が push 全体を拒否する）。
仕組みと回避策（ワーカーが patch を出力し、リーダーが適用して commit）は
[`.claude/skills/parallel-development/CORE.md`](../../.claude/skills/parallel-development/CORE.md) を参照。

付与しない理由:

- **頻度が低く、回避策が安い。** 13 チケット中 workflow を触ったのは 1 件のみ
- **決定 1 と衝突する。** `pull_request` の workflow は PR の merge commit 上の定義で実行されるため、
  `workflows: write` を持つワーカーは**自分のブランチで `pr-check.yml` を弱め、その弱めた版で green を取れる**。
  「ワーカーは workflow を書けない」という制約が、ゲートを required にしていない現状での CI の信頼性を支えている
- **prompt injection の到達点が広がる。** ワーカーは Issue / PR 本文という外部入力を読む。権限を与えると
  injection の影響が「変なコードを commit する」から「`claude-worker.yml` 自身の権限拡大や secrets の取り回し変更」まで広がる。
  GitHub App の権限は path 単位に絞れず、`.github/workflows/**` 全体への write が all-or-nothing になる
- 空振りした実害の本体は「権限が無いこと」ではなく**「拒否が無音だったこと」**で、そちらは CORE.md への追記で緩和済み

再検討するのは workflow 変更タスクが恒常化した場合のみ。その場合でも、付与の**前に**
`.github/workflows/**` への変更へ人間レビューを必須化する ruleset（または CODEOWNERS + required review）を入れること。
