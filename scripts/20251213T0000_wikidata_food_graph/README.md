# Wikidata 食品グラフ抽出スクリプト

## 概要

このディレクトリには、Wikidata から料理・飲み物のグラフ構造を取得し、BigQuery に構造化するスクリプトが含まれています。

チケット: #533

## 目的

グルメアプリ「なに食べよ」のカテゴリレコメンド API で利用する
**料理・デザート・飲み物（含アルコール / コーヒー / 茶）の世界共通マスタ** を準備するため、
Wikidata から **料理・飲み物のグラフ構造（ノード＋祖先情報）を BigQuery に構造化** します。

これにより、**「祖先（ancestor）を指定して、その配下の料理・飲み物を一括ブラックリスト化」できる状態** になり、
ブラックリストのボリュームや内容を見てから、アプリ用マスタへの導入可否を判断できるようにします。

## 前提条件

### BigQuery Dataset

以下の Dataset を作成してください：

```bash
cd ../../infra/big-query
./20251213T0000_setup_wikidata_food_graph_dataset.sh
```

これにより `food-scroll.wikidata_food_graph` Dataset が作成されます。

### Python 環境

Python 3.8 以上が必要です：

```bash
python3 --version
```

### 依存パッケージのインストール

```bash
pip install -r requirements.txt
```

### GCP 認証

```bash
gcloud auth application-default login
gcloud config set project food-scroll
```

## 使用方法

スクリプトは3つのステップに分かれています。順番に実行してください。

### ステップ 1: テーブル作成

BigQuery にテーブルを作成します。

```bash
python3 1_1_create_tables.py
```

**処理内容:**
- food_roots テーブル作成 ＋ 初期データ投入
- food_nodes_raw テーブル作成
- food_paths テーブル作成
- dish_root_summary テーブル作成
- dish_ancestor_blacklist テーブル作成
- dish_blacklist テーブル作成

### ステップ 2: ノードデータの取得とロード

Wikidata からノードデータを取得し、BigQuery にロードします。

```bash
# 全件取得（時間がかかります）
python3 1_2_fetch_and_load_nodes.py

# 開発・テスト用：ノード数を制限
python3 1_2_fetch_and_load_nodes.py --limit 1000
```

**処理内容:**
- Wikidata から料理・飲み物のノードを取得
- food_nodes_raw にロード
- 親子エッジ（P31, P279）を取得
- エッジデータを一時ファイルに保存

**注意点:**
- SPARQL endpoint への大量リクエストが発生するため、実行には時間がかかります
- rate limit 対策として retry/backoff が実装されています

### ステップ 3: パスとサマリーの生成

food_paths, dish_root_summary, dish_blacklist を生成します。

```bash
python3 1_3_generate_paths_and_summary.py
```

**処理内容:**
- food_paths を生成（recursive CTE で全 ancestor を展開）
- dish_root_summary を生成
- dish_blacklist を自動生成（ancestor ベース）

### dish_blacklist の再生成

dish_ancestor_blacklist を更新した後、dish_blacklist を再生成する場合は、ステップ3のみを再実行してください。

```bash
# dish_ancestor_blacklist にデータを追加
# 例: INSERT INTO `food-scroll.wikidata_food_graph.dish_ancestor_blacklist`
#     (ancestor_qid, reason, created_at) VALUES
#     ('Q5195', 'too_generic', CURRENT_TIMESTAMP());

# dish_blacklist を再生成
python3 1_3_generate_paths_and_summary.py
```

## 処理フロー

スクリプトは以下の3ステップで構成されています：

### ステップ 1: テーブル作成 (`1_1_create_tables.py`)
```
BigQuery migration 実行
↓
- food_roots テーブル作成 ＋ 初期データ投入
- food_nodes_raw テーブル作成
- food_paths テーブル作成
- dish_root_summary テーブル作成
- dish_ancestor_blacklist テーブル作成
- dish_blacklist テーブル作成
```

### ステップ 2: ノード取得とロード (`1_2_fetch_and_load_nodes.py`)
```
Wikidata から food_nodes_raw 相当のデータを取得
↓
- food_roots に含まれる root_qid のいずれかに対して
  ?item wdt:P31/wdt:P279* ?root_qid を満たすノードを取得
- ラベル（日本語・英語）と説明を取得
↓
BigQuery にノードデータをロード
↓
- food_nodes_raw にデータを INSERT
↓
Wikidata から親子エッジ（P31/P279）を取得
↓
- 各ノードの直接の親を取得
- エッジデータを一時ファイルに保存（/tmp/wikidata_food_graph/edges.json）
```

### ステップ 3: パスとサマリー生成 (`1_3_generate_paths_and_summary.py`)
```
エッジデータを読み込む
↓
BigQuery で food_paths を生成
↓
- recursive CTE を使って全 ancestor を展開
- depth < 20 の制限を設定
↓
dish_root_summary を生成
↓
- food_paths と food_roots を JOIN
- 各 dish がどの root にぶら下がっているかを集約
↓
dish_blacklist を自動生成
↓
- dish_ancestor_blacklist を参照
- 該当する ancestor を持つ dish を抽出
- reason='ancestor' として dish_blacklist に INSERT
```

## 作成される BigQuery テーブル

### 1. food_roots

ルートクラス定数テーブル。

**初期データ:**

- Q746549 - dish（料理）
- Q8495 - dessert（デザート）
- Q40050 - beverage（飲み物）
- Q154 - alcoholic beverage（アルコール飲料）
- Q659563 - snack（スナック）
- Q182940 - confectionery（菓子）
- Q8486 - coffee（コーヒー）
- Q4006 - tea（茶）

### 2. food_nodes_raw

Wikidata から取得したノード情報。

**カラム:**

- `item_qid`: Wikidata QID
- `label_ja`: 日本語ラベル
- `label_en`: 英語ラベル
- `desc_ja`: 日本語説明
- `desc_en`: 英語説明

### 3. food_paths

各ノードの全 ancestor を depth 付きで保持。

**カラム:**

- `child_qid`: 子ノード
- `ancestor_qid`: 祖先ノード
- `depth`: 距離 (0=自分自身, 1=直親, 2=祖父, ...)

### 4. dish_root_summary

各 dish がどの root にぶら下がっているかを集約（分析用）。

**カラム:**

- `dish_qid`: dish QID
- `roots`: ARRAY<STRUCT<root_qid, kind, min_depth>>

### 5. dish_ancestor_blacklist

人手でメンテする ancestor ブラックリスト。

**カラム:**

- `ancestor_qid`: NG とする祖先ノード
- `reason`: 理由（'too_generic', 'cuisine', 'ingredient' など）
- `created_at`: 作成日時

**例:**

```sql
INSERT INTO `food-scroll.wikidata_food_graph.dish_ancestor_blacklist`
(ancestor_qid, reason, created_at) VALUES
('Q5195', 'too_generic', CURRENT_TIMESTAMP()),  -- cuisine
('Q28540', 'ingredient', CURRENT_TIMESTAMP());   -- wheat
```

### 6. dish_blacklist

実際にブラックリスト対象とする dish を保持。

**カラム:**

- `dish_qid`: NG とする dish
- `reason`: 理由（'ancestor', 'manual', 'quality' など）
- `note`: メモ
- `created_at`: 作成日時

このテーブルは `dish_ancestor_blacklist` から自動生成されます（reason='ancestor'）。

## BigQuery での確認方法

### テーブル一覧の確認

```bash
bq ls --project_id=food-scroll wikidata_food_graph
```

### food_roots の確認

```sql
SELECT * FROM `food-scroll.wikidata_food_graph.food_roots`
ORDER BY root_qid;
```

### food_nodes_raw の確認

```sql
SELECT COUNT(*) FROM `food-scroll.wikidata_food_graph.food_nodes_raw`;

SELECT * FROM `food-scroll.wikidata_food_graph.food_nodes_raw`
WHERE label_ja IS NOT NULL
LIMIT 10;
```

### food_paths の確認

```sql
SELECT COUNT(*) FROM `food-scroll.wikidata_food_graph.food_paths`;

-- 特定の dish の ancestor を確認
SELECT * FROM `food-scroll.wikidata_food_graph.food_paths`
WHERE child_qid = 'Q753'  -- sushi
ORDER BY depth;
```

### dish_root_summary の確認

```sql
SELECT COUNT(*) FROM `food-scroll.wikidata_food_graph.dish_root_summary`;

-- 複数の root にぶら下がっている dish を確認
SELECT
  dish_qid,
  ARRAY_LENGTH(roots) AS root_count,
  roots
FROM `food-scroll.wikidata_food_graph.dish_root_summary`
WHERE ARRAY_LENGTH(roots) > 1
LIMIT 10;
```

### dish_blacklist の確認

```sql
SELECT COUNT(*) FROM `food-scroll.wikidata_food_graph.dish_blacklist`;

SELECT * FROM `food-scroll.wikidata_food_graph.dish_blacklist`
WHERE reason = 'ancestor'
LIMIT 10;
```

## トラブルシューティング

### SPARQL endpoint がタイムアウトする

retry/backoff が実装されていますが、それでも失敗する場合は：

```bash
# ノード数を制限して実行
python3 1_2_fetch_and_load_nodes.py --limit 1000
```

### BigQuery への認証エラー

```bash
# GCP 認証を再実行
gcloud auth application-default login
gcloud config set project food-scroll
```

### テーブルが作成されない

```bash
# migration を手動で実行
cd ../../infra/big-query/migration
bq query --use_legacy_sql=false < 20251213T0000_create_wikidata_food_tables.sql
```

## ファイル構成

```
scripts/20251213T0000_wikidata_food_graph/
├── __init__.py
├── 1_1_create_tables.py         # ステップ1: テーブル作成
├── 1_2_fetch_and_load_nodes.py  # ステップ2: ノード取得とロード
├── 1_3_generate_paths_and_summary.py  # ステップ3: パスとサマリー生成
├── wikidata_client.py           # Wikidata SPARQL クライアント
├── loader_bigquery.py           # BigQuery ロード・処理ロジック
├── requirements.txt             # Python 依存パッケージ
└── README.md                    # このファイル
```

## 注意事項

- SPARQL endpoint への大量リクエストが発生するため、ステップ2の実行には時間がかかります（数万件で数時間程度）
- rate limit 対策として retry/backoff が実装されていますが、失敗する可能性があります
- 各ステップは独立しているため、失敗した場合はそのステップから再実行できます
- dish_ancestor_blacklist は手動でメンテする必要があります
- このスクリプトは PostgreSQL の `dish_categories` を更新しません
- プロジェクト（food-scroll）とデータセット（wikidata_food_graph）は固定値です

## 次のステップ

1. BigQuery でデータを確認する
2. `dish_ancestor_blacklist` に除外したい ancestor QID を追加する
3. スクリプトを再実行して `dish_blacklist` を更新する
4. ブラックリストのボリュームや内容を確認する
5. アプリ用マスタ（`dish_categories`）への導入可否を判断する

## 関連ドキュメント

- [infra/big-query/README.md](../../infra/big-query/README.md): BigQuery インフラストラクチャ全体の説明
- [infra/big-query/migration/20251213T0000_create_wikidata_food_tables.sql](../../infra/big-query/migration/20251213T0000_create_wikidata_food_tables.sql): テーブル定義 SQL

## 関連チケット

- #533: Wikidata 由来の料理・飲み物グラフ構造テーブル作成（BigQuery）
