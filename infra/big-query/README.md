# BigQuery インフラストラクチャ

このディレクトリには、BigQuery 関連のインフラストラクチャスクリプトとマイグレーションが含まれています。

## 概要

BigQuery は以下の目的で使用されています：

1. **ログ基盤**: Cloud Logging からのログを収集・分析
2. **Wikidata 食品グラフ**: 料理・飲み物のマスタデータ構造管理

## ディレクトリ構成

```
infra/big-query/
├── migration/                              # BigQuery テーブル定義 SQL
│   ├── 20251203T0000_backfill_legacy_log_tables_and_views.sql
│   └── 20251213T0000_create_wikidata_food_tables.sql
├── 20251201T0000_setup_logging_and_bigquery_sink.sh
├── 20251203T0000_backfill_supabase_logs_to_bigquery.sh
├── 20251213T0000_setup_wikidata_food_graph_dataset.sh  # Wikidata 食品グラフ用データセット作成
├── setup_logging_bigquery_dataset.sh
├── setup_logging_sink.sh
├── IMPLEMENTATION_SUMMARY.md               # ログバックフィル実装サマリー
├── README_BACKFILL.md                      # バックフィル詳細ガイド
└── README.md                               # このファイル
```

## 1. ログ基盤

### 概要

Cloud Logging → BigQuery Sink を通じて、アプリケーションログを BigQuery に集約します。

### 対象テーブル

- `frontend_event_logs`: フロントエンドのイベントログ
- `backend_event_logs`: バックエンドのイベントログ
- `external_api_logs`: 外部 API 呼び出しログ

### セットアップ

```bash
# dev / prod 両方まとめて実行
./20251201T0000_setup_logging_and_bigquery_sink.sh all

# 個別環境
./20251201T0000_setup_logging_and_bigquery_sink.sh dev
./20251201T0000_setup_logging_and_bigquery_sink.sh prod
```

### バックフィル

Supabase からのログデータをバックフィルする場合：

```bash
./20251203T0000_backfill_supabase_logs_to_bigquery.sh dev
./20251203T0000_backfill_supabase_logs_to_bigquery.sh prod
```

詳細は [README_BACKFILL.md](./README_BACKFILL.md) を参照してください。

## 2. Wikidata 食品グラフテーブル

### 概要

Wikidata から取得した料理・飲み物のグラフ構造を BigQuery に構造化します。
これにより、祖先（ancestor）ベースのブラックリスト機能を実現し、
アプリ用マスタ（`dish_categories`）への導入判断を可能にします。

### セットアップ

```bash
# データセット作成
./20251213T0000_setup_wikidata_food_graph_dataset.sh
```

これにより `food-scroll.wikidata_food_graph` Dataset が作成されます。

### テーブル構成

#### 2.1. `food_roots` - ルートクラス定数テーブル

Wikidata から取得する対象の「ルートクラス（料理・飲み物のトップ階層）」を定義。

**スキーマ:**

```sql
CREATE TABLE food_roots (
  root_qid   STRING,   -- 例: 'Q746549'
  kind       STRING    -- 'dish' / 'dessert' / 'beverage' など
);
```

**初期データ:**

- `Q746549` - dish（料理）
- `Q8495` - dessert（デザート）
- `Q40050` - beverage（飲み物）
- `Q154` - alcoholic beverage（アルコール飲料）
- `Q659563` - snack（スナック）
- `Q182940` - confectionery（菓子）
- `Q8486` - coffee（コーヒー）
- `Q4006` - tea（茶）

#### 2.2. `food_nodes_raw` - ノードテーブル

Wikidata から取得した「料理・飲み物候補ノード」の原情報。

**スキーマ:**

```sql
CREATE TABLE food_nodes_raw (
  item_qid   STRING,  -- 例: 'Q12345'
  label_ja   STRING,
  label_en   STRING,
  desc_ja    STRING,
  desc_en    STRING
);
```

#### 2.3. `food_paths` - 祖先テーブル

各ノードの全 ancestor（親・祖父・曾祖父…）を depth 付きで保持。

**スキーマ:**

```sql
CREATE TABLE food_paths (
  child_qid     STRING,  -- 子ノード
  ancestor_qid  STRING,  -- 祖先ノード
  depth         INT64    -- 距離 (0=自分自身, 1=直親, 2=祖父, ...)
);
```

#### 2.4. `dish_root_summary` - ルート集約テーブル（分析用）

各 dish がどのルートクラスに、何ステップでぶら下がっているかを把握。

**スキーマ:**

```sql
CREATE TABLE dish_root_summary (
  dish_qid   STRING,
  roots      ARRAY<STRUCT<
                root_qid   STRING,
                kind       STRING,
                min_depth  INT64
              >>
);
```

#### 2.5. `dish_ancestor_blacklist` - ancestor ブラックリスト

「この ancestor を持つ dish は除外候補」という人手メンテ用テーブル。

**スキーマ:**

```sql
CREATE TABLE dish_ancestor_blacklist (
  ancestor_qid   STRING,
  reason         STRING,
  created_at     TIMESTAMP
);
```

**例:**

- `Q5195` - 'cuisine'（料理の種類）→ あまりに抽象的なため除外
- `Q28540` - 'wheat'（小麦）→ 食材レベルは除外

#### 2.6. `dish_blacklist` - dish ブラックリスト

実際にブラックリスト対象とする dish QID を保持。

**スキーマ:**

```sql
CREATE TABLE dish_blacklist (
  dish_qid   STRING,
  reason     STRING,  -- 'ancestor', 'manual', 'quality' など
  note       STRING,
  created_at TIMESTAMP
);
```

### データフロー

```
1. Wikidata SPARQL クエリ
   ↓
2. food_roots に基づいて対象ノードを取得
   ↓
3. food_nodes_raw にノード情報を保存
   ↓
4. P31/P279 エッジを辿って food_paths を生成
   ↓
5. food_paths + food_roots から dish_root_summary を生成
   ↓
6. dish_ancestor_blacklist を参照して dish_blacklist を自動生成
```

### マイグレーション

テーブル定義は以下の SQL ファイルで管理されています：

```
migration/20251213T0000_create_wikidata_food_tables.sql
```

### データ投入スクリプト

データの取得と投入は以下のスクリプトで実行します：

```
scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/
```

詳細は [scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/README.md](../../scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/README.md) を参照してください。

## Dataset 構成

### dev 環境

- **Project**: `food-scroll`
- **Dataset**: `nanitabeyo_logs_dev`
- **Location**: `asia-northeast1`
- **TTL**: 90日

### prod 環境

- **Project**: `food-scroll`
- **Dataset**: `nanitabeyo_logs_prod`
- **Location**: `asia-northeast1`
- **TTL**: 730日（2年）

## 参考

### 関連チケット

- #487: Cloud Logging / BigQuery ログ基盤セットアップ
- #523: Cloud Logging Sink セットアップ・VIEW 作成
- #531: Supabase → BigQuery バックフィル実装
- #533: Wikidata 由来の料理・飲み物グラフ構造テーブル作成

### 関連ドキュメント

- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md): ログバックフィル実装サマリー
- [README_BACKFILL.md](./README_BACKFILL.md): バックフィル詳細ガイド
