# チケット #741 実装サマリ

## 変更概要

Wikidata Food Graph Step2 のロード堅牢化を実装しました。

### 主な変更点

1. **staging テーブルの追加**
   - `food_nodes_raw_staging` テーブルを BigQuery migration で作成
   - `CLUSTER BY item_qid` で検索効率化

2. **Load Job 方式への移行**
   - `insert_rows_json` (streaming insert) から Load Job (JSONL) に変更
   - 部分失敗・欠損のリスクを排除

3. **MERGE による累積運用**
   - staging → raw への MERGE により冪等性を確保
   - staging に無い QID は削除しない（累積運用）

4. **food_roots テーブル駆動**
   - ハードコードされた `FOOD_ROOTS` 定数を削除
   - BigQuery の `food_roots` テーブルから動的に取得

5. **観測性の向上**
   - staging の統計情報取得（件数、欠損率等）
   - MERGE 前後の比較ロギング
   - 新規 QID 数の算出

## ファイル変更

### 新規作成

- `infra/big-query/migration/20260210T0000_add_food_nodes_raw_staging.sql`
  - staging テーブル作成 migration

### 変更ファイル

- `scripts/20251213T0000_wikidata_food_graph/loader_bigquery.py`
  - `fetch_food_roots()`: food_roots テーブルから取得
  - `load_food_nodes_to_staging()`: Load Job で staging にロード
  - `merge_food_nodes_from_staging()`: staging → raw に MERGE
  - `get_staging_summary()`: staging の統計情報取得
  - `_count_distinct_qids()`: 件数カウントヘルパー
  - `_count_new_qids()`: 新規 QID カウントヘルパー

- `scripts/20251213T0000_wikidata_food_graph/1_2_fetch_and_load_nodes.py`
  - `FOOD_ROOTS` 定数を削除
  - Phase 0 追加: food_roots を BigQuery から取得
  - Phase 2 変更: Load Job でロード
  - Phase 2.5 追加: staging 整合性チェック
  - Phase 3 変更: MERGE 実行
  - 詳細なサマリログ出力

- `scripts/20251213T0000_wikidata_food_graph/1_1_create_tables.py`
  - 新 migration ファイルを追加

## 動作確認手順

### 1. マイグレーション実行

```bash
cd /home/runner/work/nanitabeyo/nanitabeyo/scripts/20251213T0000_wikidata_food_graph
python3 1_1_create_tables.py
```

- `food_nodes_raw_staging` テーブルが作成されることを確認

### 2. Step2 実行（開発モード）

```bash
cd /home/runner/work/nanitabeyo/nanitabeyo/scripts/20251213T0000_wikidata_food_graph
python3 1_2_fetch_and_load_nodes.py --limit 1000
```

期待される動作:

- Phase 0: food_roots を BigQuery から取得
- Phase 1: 各 root からノードを取得
- Phase 2: Load Job で staging にロード
- Phase 2.5: staging の整合性チェック
- Phase 3: MERGE 実行
- Phase 4: エッジ取得
- サマリログ出力

### 3. BigQuery 検証

```sql
-- staging テーブルの件数確認
SELECT COUNT(DISTINCT item_qid) FROM `food-scroll.wikidata_food_graph.food_nodes_raw_staging`;

-- raw テーブルの件数確認
SELECT COUNT(DISTINCT item_qid) FROM `food-scroll.wikidata_food_graph.food_nodes_raw`;

-- 特定 QID の確認（coffee, hamburger など）
SELECT * FROM `food-scroll.wikidata_food_graph.food_nodes_raw`
WHERE item_qid IN ('Q8486','Q6663');
```

## 完了条件

- [x] `insert_rows_json` による nodes 投入が撤廃
- [x] Load Job 経由のロード実装
- [x] root 定義が `food_roots` テーブル駆動
- [x] `food_nodes_raw_staging` の migration 追加
- [x] `food_nodes_raw` は staging から MERGE
- [x] staging に無い QID は削除しない
- [x] 実行ログから新規 QID 数・件数・欠損が追える

## 次のステップ

実際の動作確認のため、以下を実行する必要があります：

1. マイグレーション実行（dev or prod 環境）
2. `--limit 1000` での Step2 実行
3. BigQuery での結果確認

注意: 実際の BigQuery への接続には GCP 認証が必要です。
