# macro_genre ホワイトリスト運用スクリプト

## 概要

このディレクトリには、macro_genre（粗い料理枠）をホワイトリストで運用するためのスクリプトが含まれています。

チケット: #550

## 目的

カテゴリレコメンド API のスレート多様性制御のために、各 dish（Wikidata QID）へ **粗い料理枠（macro_genre）** を付与します。

BigQuery 上で `macro_genre_whitelist` に基づく macro_genre の決定結果を作成し、人手レビュー可能な形（CSV 出力＋曖昧フラグ）で提供します。

## 前提条件

### BigQuery Dataset

親ディレクトリの README を参照して、`wikidata_food_graph` Dataset を作成してください。

### Python 環境

親ディレクトリの requirements.txt をインストールしてください：

```bash
cd ..
pip install -r requirements.txt
```

### 既存テーブル

以下のテーブルが既に存在している必要があります：

- `food_nodes_raw`
- `food_paths`
- `dish_blacklist`
- `dish_category_catalog`

親ディレクトリのスクリプト（1_1, 1_2, 1_3, 3_1）を実行して、これらのテーブルを作成してください。

## 使用方法

スクリプトは4つのステップに分かれています。順番に実行してください。

### ステップ 1: food_edges_raw の構築

Wikidata から child→parent のエッジを取得し、BigQuery にロードします。

```bash
python3 1_1_build_food_edges_raw.py
```

**処理内容:**

- `food_nodes_raw` から全ノード QID を取得
- Wikidata から親エッジ（P31, P279）を取得
- `food_edges_raw` にロード

**注意点:**

- 既に `food_edges_raw` がある場合は上書きされます
- SPARQL endpoint への大量リクエストが発生するため、時間がかかります

### ステップ 2: dish_macro_genre_analysis の構築

macro_genre_whitelist と food_paths を用いて macro_genre を決定します。

```bash
python3 1_3_build_dish_macro_genre_analysis.py
```

**処理内容:**

- `dish_category_catalog` の item を対象
- `food_paths` を `macro_genre_whitelist` と JOIN
- min depth を求め、候補数で ambiguous 判定
- `CREATE OR REPLACE TABLE` で再生成

**出力:**

- `macro_genre_qid`（ambiguous なら NULL）
- `macro_genre_depth`
- `macro_genre_ambiguous`
- `macro_genre_candidates`（min depth 全件 + 最大 10 件）
- `computed_at`

### ステップ 4: whitelist 候補の分布 CSV 出力

whitelist 作成の材料として、祖先分布を CSV 出力します。

```bash
# デフォルト出力（macro_genre_candidate_stats.csv）
python3 1_4_export_macro_genre_candidate_stats.py

# 出力先を指定
python3 1_4_export_macro_genre_candidate_stats.py --output /path/to/output.csv
```

**出力例:**

- `ancestor_qid`
- `label_ja`, `label_en`
- `hit_count`（何件の dish がその祖先を持つか）
- `example_items`（数件、QID と label）

### ステップ 3: whitelist 候補の分布 CSV 出力

whitelist 作成の材料として、祖先分布を CSV 出力します。

```bash
# デフォルト出力（macro_genre_candidate_stats.csv）
python3 1_4_export_macro_genre_candidate_stats.py

# 出力先を指定
python3 1_4_export_macro_genre_candidate_stats.py --output /path/to/output.csv
```

**出力例:**

- `ancestor_qid`
- `label_ja`, `label_en`
- `hit_count`（何件の dish がその祖先を持つか）
- `example_items`（数件、QID と label）

### ステップ 4: macro_genre 割当結果の CSV 出力

レビュー用に、割当結果を CSV 出力します。

```bash
# 全件出力
python3 1_5_export_macro_genre_review.py

# 曖昧なものだけ出力
python3 1_5_export_macro_genre_review.py --ambiguous-only

# NULL のものだけ出力
python3 1_5_export_macro_genre_review.py --null-only

# 出力先を指定
python3 1_5_export_macro_genre_review.py --output /path/to/output.csv
```

**出力例:**

- `item_qid`, `label_ja/en`
- `macro_genre_qid`, `macro_genre_depth`, `macro_genre_ambiguous`
- `macro_genre_candidates`（JSON 文字列）
- `tags`（JSON 文字列）

## 運用フロー

### 初回実行

1. **テーブル作成**

   ```bash
   # 親ディレクトリで migration を実行（まだの場合）
   cd ..
   python3 1_1_create_tables.py

   # macro_genre 用テーブルを作成
   cd 550_macro_genre
   # 手動で migration を実行するか、後述の自動実行を利用
   ```

2. **food_edges_raw 構築**

   ```bash
   python3 1_1_build_food_edges_raw.py
   ```

3. **catalog 構築**（親ディレクトリで実行）

   ```bash
   cd ..
   python3 3_1_build_dish_category_catalog.py
   cd 550_macro_genre
   ```

4. **候補分布 CSV 出力**

   ```bash
   python3 1_4_export_macro_genre_candidate_stats.py
   ```

5. **whitelist 手動更新**
   - CSV を確認して、macro_genre として採用する QID を決定
   - BigQuery で `macro_genre_whitelist` に INSERT

   ```sql
   INSERT INTO `food-scroll.wikidata_food_graph.macro_genre_whitelist`
   (item_qid, reason, created_at) VALUES
   ('Q5195', 'cuisine_category', CURRENT_TIMESTAMP()),
   ('Q746549', 'dish_root', CURRENT_TIMESTAMP());
   ```

6. **analysis 構築**

   ```bash
   python3 1_3_build_dish_macro_genre_analysis.py
   ```

7. **レビュー CSV 出力**
   ```bash
   python3 1_5_export_macro_genre_review.py --ambiguous-only
   ```

### whitelist の見直し

whitelist を更新した後、以下のステップを再実行することで結果が更新されます。

```bash
# 1. analysis を再構築
python3 1_3_build_dish_macro_genre_analysis.py

# 2. レビュー CSV を再出力
python3 1_5_export_macro_genre_review.py
```

## 作成される BigQuery テーブル

### 1. macro_genre_whitelist

macro_genre として採用する QID を手動で管理するテーブル。

**カラム:**

- `item_qid`: macro_genre として採用する QID
- `reason`: メモ用途
- `created_at`: 作成日時

**例:**

```sql
INSERT INTO `food-scroll.wikidata_food_graph.macro_genre_whitelist`
(item_qid, reason, created_at) VALUES
('Q5195', 'cuisine_category', CURRENT_TIMESTAMP());
```

### 2. food_edges_raw

Wikidata から取得したエッジ情報。

**カラム:**

- `child_qid`: 子ノード QID
- `parent_qid`: 親ノード QID

**注意:**

- 既存実装は P31/P279 を区別しないため、property フィールドは持たない

### 3. dish_category_catalog

blacklist 除外済み準マスタ（親ディレクトリで 3_1_build_dish_category_catalog.py により生成）。

**カラム:**

- `item_qid`: dish QID
- `label_ja`, `label_en`: ラベル
- `desc_ja`, `desc_en`: 説明
- `image_url`: 画像 URL（今回は NULL）
- `tags`: 祖先 QID の配列（depth<=5）

### 4. dish_macro_genre_analysis

macro_genre 割当の分析テーブル。

**カラム:**

- `item_qid`: dish QID
- `macro_genre_qid`: 決定された macro_genre QID（曖昧時は NULL）
- `macro_genre_depth`: 最短距離
- `macro_genre_ambiguous`: 曖昧フラグ
- `macro_genre_candidates`: 候補の配列
- `computed_at`: 計算日時

## macro_genre 決定ロジック

各 dish について、以下のロジックで macro_genre を決定します：

1. `food_paths` を `macro_genre_whitelist` と JOIN し、whitelist に当たる祖先候補を抽出
2. `depth` の最小値（min depth）を求め、最短距離の候補集合を得る
3. 最短候補が
   - **1 件** → その `ancestor_qid` を `macro_genre_qid` とする
   - **複数件** → `macro_genre_ambiguous = true`、`macro_genre_qid = NULL`
4. whitelist にヒット無し → `macro_genre_qid = NULL`

## BigQuery での確認方法

### テーブル一覧の確認

```bash
bq ls --project_id=food-scroll wikidata_food_graph
```

### macro_genre_whitelist の確認

```sql
SELECT * FROM `food-scroll.wikidata_food_graph.macro_genre_whitelist`
ORDER BY item_qid;
```

### dish_category_catalog の確認

```sql
SELECT COUNT(*) FROM `food-scroll.wikidata_food_graph.dish_category_catalog`;

SELECT * FROM `food-scroll.wikidata_food_graph.dish_category_catalog`
WHERE label_ja IS NOT NULL
LIMIT 10;
```

### dish_macro_genre_analysis の確認

```sql
SELECT COUNT(*) FROM `food-scroll.wikidata_food_graph.dish_macro_genre_analysis`;

-- 曖昧なものを確認
SELECT * FROM `food-scroll.wikidata_food_graph.dish_macro_genre_analysis`
WHERE macro_genre_ambiguous = TRUE
LIMIT 10;

-- macro_genre が決定されたものを確認
SELECT * FROM `food-scroll.wikidata_food_graph.dish_macro_genre_analysis`
WHERE macro_genre_qid IS NOT NULL
LIMIT 10;
```

## トラブルシューティング

### SPARQL endpoint がタイムアウトする

retry/backoff が実装されていますが、それでも失敗する場合は：

- 親ディレクトリのスクリプトで既に edges が取得されている場合、それを流用できます
- `/tmp/wikidata_food_graph/edges.json` が存在する場合は再利用されます

### BigQuery への認証エラー

```bash
# GCP 認証を再実行
gcloud auth application-default login
gcloud config set project food-scroll
```

### テーブルが作成されない

```bash
# migration を手動で実行
cd ../../../infra/big-query/migration
sed 's/${DATASET}/food-scroll.wikidata_food_graph/g' 20251213T0000_create_macro_genre_tables.sql | bq query --use_legacy_sql=false
```

## ファイル構成

```
scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/550_macro_genre/
├── 0_create_macro_genre_tables.py          # テーブル作成
├── 1_1_build_food_edges_raw.py             # ステップ1: エッジデータ構築
├── 1_3_build_dish_macro_genre_analysis.py  # ステップ2: analysis 構築
├── 1_4_export_macro_genre_candidate_stats.py # ステップ3: 候補分布 CSV 出力
├── 1_5_export_macro_genre_review.py        # ステップ4: レビュー CSV 出力
└── README.md                               # このファイル

scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/
└── 3_1_build_dish_category_catalog.py      # カタログ構築（前提）
```

## 注意事項

- スクリプトは親ディレクトリの `loader_bigquery.py` と `wikidata_client.py` を利用します
- 各ステップは独立しているため、失敗した場合はそのステップから再実行できます
- `macro_genre_whitelist` は手動でメンテする必要があります
- このスクリプトは PostgreSQL の `dish_categories` を更新しません（別チケット対応）
- プロジェクト（food-scroll）とデータセット（wikidata_food_graph）は固定値です

## 次のステップ

1. BigQuery でデータを確認する
2. `macro_genre_whitelist` に採用する QID を追加する
3. スクリプトを再実行して結果を更新する
4. レビュー CSV で曖昧なケースを確認する
5. whitelist を調整して再実行する
6. 結果を PostgreSQL の `dish_categories` に反映する（別チケット）

## 関連ドキュメント

- [親ディレクトリ README](../README.md): Wikidata 食品グラフ抽出スクリプト全体の説明
- [infra/big-query/migration/20251213T0000_create_macro_genre_tables.sql](../../../infra/big-query/migration/20251213T0000_create_macro_genre_tables.sql): テーブル定義 SQL

## 関連チケット

- #550: macro_genre（Wikidata）ホワイトリスト運用＋割当結果テーブル作成（BigQuery）
- #533: Wikidata 由来の料理・飲み物グラフ構造テーブル作成（BigQuery）
