---
name: dish-feature-correction
description: 料理カテゴリの feature score（dining_pace, timeSlot, scene, satiety, taste 等の dish_category_features）が実運用でおかしいと気づいたとき（例:「サクッと」で検索すると焼き鳥が出てくる）に使う。原因調査（個別値の異常か rubric 自体の欠陥か）、影響範囲の相対キャリブレーション確認、manual correction scripts による BigQuery 補正、PostgreSQL dev への反映、recommendation regression 確認までを扱う。「この特徴量おかしくない？」「この検索結果、なんか変」「feature を直したい」と言われたとき、あるいは推薦結果のレビュー中に文脈的に不自然な候補を見つけたときに使う。
---

# Dish Feature Correction

料理カテゴリ推薦（`dish_category_features` パイプライン）の feature score が
実運用の感覚とズレているのを見つけたときに、場当たり的にデータを1行直すのではなく、
「rubric の欠陥か個別値の異常か」を切り分けてから安全に補正するためのスキル。

Issue #1383（`dining_pace:quick` で焼き鳥が過大評価されていた件）で、
再利用可能な manual correction 基盤として整備した。

このスキルを使うときは、次を順に読み、両方を適用する。

1. [`INVESTIGATE.md`](./INVESTIGATE.md) — 違和感の原因を確定する調査の型。
   個別カテゴリの異常（Case A）か rubric 自体の欠陥（Case B）かを判断する基準
2. [`APPLY.md`](./APPLY.md) — 判断が付いた後、実際に BigQuery → PostgreSQL dev まで
   安全に反映し、recommendation への影響を確認する手順

**役割分担**（追記先を迷ったらこの表で決める）:

| | 何を書くか | 書かないこと |
|---|---|---|
| INVESTIGATE.md | 調査クエリ、Case A/B の判断基準、相対キャリブレーションの見方 | 補正の実行手順 |
| APPLY.md | manual/ scripts・GitHub Actions の使い方、検証、rollback | 判断基準そのもの |

補正が必要な行の実データ書き込みは、このリポジトリの他の DB 変更と同様
GitHub Actions（`.github/workflows/db-script-run.yml`、`scripts/` 配下の任意の
Python スクリプトを `script_path` + `args` で実行できる汎用ランナー）から行う。
ローカル/対話セッションから直接 BigQuery Python client や `DATABASE_URL` を叩く運用は
想定していない（資格情報を対話セッションに置かないため）。

## 全体の流れ

```text
実運用で違和感（検索結果がおかしい）
   ↓
INVESTIGATE.md ── 対象 feature_type/feature_key の全件を一覧化し、相対キャリブレーションを見る
   ↓
Case A: 個別カテゴリだけが過大/過小       Case B: quick=1 等の判定基準自体が広すぎる
   │  rubric は維持、値のみ補正                │  866_dining_pace/dining_pace_prompt.md 等の
   │                                            │  rubric ドキュメントを先に修正し、
   │                                            │  「仕様と実データの不整合」を残さない
   └────────────────┬───────────────────────────┘
                     ↓
APPLY.md ── manual/1_insert → manual/2_merge → 9_2 sync dev（すべて GitHub Actions経由）
   ↓
recommendation regression（対象条件を複数回実行し、jitter込みで確認）
   ↓
Issue に調査結果・判断根拠・before/after を記録する（次回の判断材料として残す）
   ↓
問題なければ production（--schema public）へ反映
```

## 前提知識（毎回読み直さなくてよい固定事実）

- BigQuery が source of truth、PostgreSQL は serving（全置換で同期される）。
  PostgreSQL を直接編集する運用は存在しない・作らない。
- 補正の実処理は
  `scripts/20251213T0000_wikidata_food_graph/581_relevance_scoring/manual/` にある
  （`1_insert_feature_scores.py` / `2_merge_feature_scores.py` / `README.md`）。
  このスキルはその使い方ガイドであり、ロジックの二重実装ではない。
  **scripts側の詳細な運用ルール（phase=manualの優先順位、rollback、production反映）は
  `manual/README.md` が正なので、そちらを読むこと。APPLY.md はそこに無い
  「スキルとしての判断ポイント」だけを補う。**
- `9_1〜9_4` の sync scripts は `--schema public`（本番）実行時に対話確認（y/N）を
  要求するが、`db-script-run.yml`（GitHub Actions、非対話環境）では `input()` が
  即 `EOFError` になり実行できない。`--yes` を明示的に渡した場合のみ確認をスキップする
  （#1383 で追加。デフォルトの対話確認は変更していない）。production 反映は
  `args: --schema public --yes` を指定する。
- `9_2_sync_dish_category_features.py`（および他の `9_X` sync scripts）は反映前に
  必ず GCS（`gs://nanitabeyo-private/system/PostgreSQL/csv_export/`）へバックアップを
  取る安全設計になっている。manual correction 専用の書き込みSAには、BigQueryの権限
  （`roles/bigquery.jobUser` + 対象datasetの `dataEditor`）だけでなく、この GCS
  パスへの書き込み権限（`roles/storage.objectCreator` 等）も必要（#1458 で判明・対応済み）。
  新しい書き込みSAを作る場合はこの2種類の権限を両方付与すること。
- feature score を変えても最終表示は同じ比率で動かない
  （`rel_score × market_salience補正 × dine_out_orderability補正 = final_score`、
  `× jitter = order_score`、2〜6枚目はさらに diversity penalty がかかる）。
  そのため必ず recommendation レベルで before/after を確認する（APPLY.md 参照）。
