# APPLY — 補正を安全に反映する

`INVESTIGATE.md` で対象カテゴリと新しい値・理由が確定した後の手順。
実行ロジックそのものは
`scripts/20251213T0000_wikidata_food_graph/581_relevance_scoring/manual/README.md`
が正なので、詳細な validation ルールや rollback 手順はそちらを参照する。
ここでは「スキルとして毎回判断すること」だけを書く。

## 0. 実行はローカルではなく GitHub Actions から

`DATABASE_URL` や GCP サービスアカウント資格情報を対話セッションに置かない運用のため、
`manual/1_insert_feature_scores.py` / `manual/2_merge_feature_scores.py` /
`9_2_sync_dish_category_features.py` は、`scripts/` 配下の Python スクリプトを汎用的に
実行できる `.github/workflows/db-script-run.yml` の workflow_dispatch から実行する
（特定スクリプト専用のworkflowではない。`script_path` + `args` で対象を指定する）。

**重要**: `workflow_dispatch` は GitHub の仕様上、**default branch（main）上に存在する
workflow ファイルしか dispatch できない**。作業ブランチにしか無い workflow は
（`ref` に作業ブランチを指定しても）404 になる。新しい workflow を追加/変更した場合は、
先にそのPRをマージしてから dispatch すること。

このセッションから直接実行したい場合は、GitHub の Actions API 経由で
workflow_dispatch を dispatch し、run のログ（または Job Summary）で結果を確認する。

inputs は以下（詳細は workflow ファイルのコメントおよび `manual/README.md` を参照）:

```text
script_path: 実行対象スクリプト（例: .../manual/2_merge_feature_scores.py）
args: スクリプトへ渡すCLI引数（例: --run-id <id> --dry-run）
input_file_path / input_file_content: --input-jsonl 等でファイル入力が要る場合のみ使う
```

まず `args` に `--dry-run` を付けて実行し、出力を人間が確認してから
`--dry-run` を外して（merge は `--apply` に差し替えて）再実行する。

## 1. run_id の命名

何を・いつ・何のために直したか run_id から追えるようにする。

```text
<YYYYMMDD>_manual_<feature_typeまたはissue概要>_<補足>
例: 20260820_manual_dining_pace_izakaya_skewers
```

## 2. insert → merge の間は必ず人間が dry-run 結果を見る

`insert` の dry-run はまだ何もデータベースへ触れていないので事故のリスクは低いが、
`merge` の `--apply`（BigQuery 採用版への実書き込み）は影響が全カテゴリの推薦に及ぶ。
`merge --dry-run` の変更対象一覧（current/new/diff）を人間の目で確認してから
`--apply` を実行すること。件数が想定と違う場合は `expected_row_count` /
`expected_item_count` を指定して事故を防ぐ。

## 3. dev sync まで

`step: sync-dev`（内部で `9_2_sync_dish_category_features.py --schema dev`）を
dry-run → 本実行の順で行う。`--schema public`（本番）はこの workflow からは
実行できない。本番反映は `manual/README.md` の「production 反映手順」を参照し、
別途 `db-migrate.yml` に準じた承認フローを用意してから行う。

## 4. recommendation regression

feature score の変更が最終順位にどう効くかは、`rel_score → final_score → order_score
（jitter）→ diversity penalty後` という多段の変換を経るため、1回の実行結果だけで
判断しない。対象の検索条件（例: `dining_pace=quick`）を複数回実行し、次を確認する。

- 補正対象カテゴリが上位へ過剰混入しなくなったか
- 明確にそのスタイルが代表的な既存カテゴリ（例: `quick=1` のラーメン等）が
  相対的に上位を維持しているか
- 補正対象を下げた結果、別の不自然な候補が繰り上がっていないか
- 変更対象と無関係な検索条件で回帰がないか

推薦 API を実行して確認できる環境がある場合はそちらを優先する。
BigQuery/DB への直接アクセスしか無い環境では、少なくとも
`dish_category_features_catalog` の該当行が意図通り更新されたことを
(`SELECT ... WHERE run_id = ...`) で確認し、live API regression は
別途フォローアップとして明記する（省略したことを黙らない）。

## 5. Issue に記録する

次の担当者（人間または次回のこのスキル呼び出し）が同じ調査をやり直さずに済むよう、
判断根拠を Issue コメントに残す。最低限:

- 調査した feature_type/feature_key の全件、上位/境界の一覧
- Case A / Case B のどちらと判断したか、その理由
- 補正した item_qid・旧値・新値・reason
- rubric ドキュメントを更新したか（した場合はその diff 概要）
- BigQuery / PostgreSQL dev への反映が完了したか（run_id、workflow run のリンク）
- recommendation regression をどこまで確認できたか（できなかった場合はその理由も明記）
- production 反映がまだの場合、それも明記する（「完了した」と書かない）
