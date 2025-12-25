# BigQuery → PostgreSQL 同期基盤

## 概要

このディレクトリには、Wikidata 由来の料理カテゴリデータを BigQuery で加工し、PostgreSQL に同期するスクリプトが含まれています。

**チケット**: #585

## アーキテクチャ

- **BigQuery**: SoT (Source of Truth)
  - `dish_category_catalog`: 料理カテゴリマスター
  - `dish_category_variant_catalog`: variants（表記揺れ）
  - `dish_category_images`: 画像候補
  - `dish_category_features_catalog`: 特徴量（gate / mood / scene 等）
  - `dish_category_localized_text_catalog`: 感情訴求型コピー
  - `dish_macro_genre_analysis`: macro_genre 割当分析

- **PostgreSQL**: Serving DB
  - `dish_categories`: 料理カテゴリ
  - `dish_category_variants`: variants
  - `dish_category_features`: 特徴量
  - `dish_category_localized_text`: localized text

## データフロー

```
[Wikidata] → [BigQuery: 加工・分析] → [PostgreSQL: Serving]
              ↑                          ↑
              | 1) variants生成          | 5) 同期（テーブル毎）
              | 2) 画像処理              |
              | 3) 特徴量生成            |
              | 4) localized text生成   |
```

## スクリプト一覧

### 1. BigQuery テーブル作成

```bash
python3 1_1_create_tables.py
```

- BigQuery に必要なテーブルを作成
- migration SQL を実行（`infra/big-query/migration/`）

### 2. Variants 生成

```bash
python3 4_1_generate_variants.py
```

- `dish_category_catalog` から variants を生成
- 正規化・重複排除を実施
- `dish_category_variant_catalog` に格納

**処理内容**:

- label_en を canonical として追加
- labels_json から全言語ラベルを抽出
- グローバル一意性を保証（表記揺れは単独一意）

### 3. 画像処理

```bash
python3 4_2_process_images.py
```

- `dish_category_catalog.image_url` から画像候補を処理
- Wikimedia Commons の実体URLに変換
- `dish_category_images` に source_type='wikimedia' として格納

**処理内容**:

- Special:FilePath からファイル名を抽出
- MediaWiki ファイル名を正規化
- MD5 ハッシュで実体URLを生成

### 4. BigQuery → PostgreSQL 同期（テーブル毎に分割）

同期スクリプトは **テーブル毎に分割** され、個別に実行できます。

#### 4.1 dish_categories の同期

```bash
# 環境変数を設定
export DATABASE_URL="postgresql://user:pass@host:port/dbname"

# 通常実行（dev スキーマ）
python3 9_1_sync_dish_categories.py --schema dev

# ドライラン（統計のみ出力、実際の変更なし）
python3 9_1_sync_dish_categories.py --schema dev --dry-run

# public スキーマ（確認プロンプトあり）
python3 9_1_sync_dish_categories.py --schema public
```

**処理内容**:

- dish_category_catalog と dish_macro_genre_analysis を JOIN
- macro_genre_qid を取得
- 画像は manual > analysis > wikimedia の優先順位で選定
- PostgreSQL へ UPSERT
- BQ に存在しないカテゴリは物理削除（CASCADE）
- 実行前に GCS へバックアップ

#### 4.2 dish_category_features の同期

```bash
# 通常実行
python3 9_2_sync_dish_category_features.py --schema dev

# ドライラン
python3 9_2_sync_dish_category_features.py --schema dev --dry-run
```

**処理内容**:

- dish_category_features_catalog から取得
- PostgreSQL へ全件置き換え（DELETE + INSERT）
- 実行前に GCS へバックアップ

#### 4.3 dish_category_localized_text の同期

```bash
# 通常実行
python3 9_3_sync_dish_category_localized_text.py --schema dev

# ドライラン
python3 9_3_sync_dish_category_localized_text.py --schema dev --dry-run
```

**処理内容**:

- dish_category_localized_text_catalog から取得
- PostgreSQL へ全件置き換え（DELETE + INSERT）
- 実行前に GCS へバックアップ

#### 4.4 dish_category_variants の同期

```bash
# 通常実行
python3 9_4_sync_dish_category_variants.py --schema dev

# ドライラン
python3 9_4_sync_dish_category_variants.py --schema dev --dry-run
```

**処理内容**:

- dish_category_variant_catalog から取得
- source='bq_generated' を付与
- PostgreSQL へ全件置き換え（DELETE + INSERT）
- 実行前に GCS へバックアップ

### 同期スクリプトの共通機能

すべての同期スクリプトは以下の機能を持ちます：

**1. スキーマバリデーション**

- `--schema` 引数で public または dev を指定（必須）
- public の場合は実行確認プロンプトを表示

**2. ドライラン機能**

- `--dry-run` オプションで実行
- 実際の変更は行わず、統計のみ出力
- 統計は `/tmp/` に保存され、ターミナルにも表示

**3. GCS バックアップ**

- 実行前に PostgreSQL テーブルを GCS にバックアップ
- バックアップ先: `gs://nanitabeyo-private/system/PostgreSQL/csv_export/YYYYMMDD-HHMMSS/{table_name}.csv`
- ドライラン時はバックアップをスキップ

**4. 統計出力**

- 挿入件数、更新件数、削除件数、スキップ件数を表示
- ドライラン時は予定件数を表示

**CASCADE 削除**:

- 親カテゴリが削除されると、以下も自動削除
  - `dish_category_variants`
  - `dish_category_features`
  - `dish_category_localized_text`

## 実行フロー（完全な手順）

### ステップ 1: PostgreSQL マイグレーション

```bash
cd /home/runner/work/nanitabeyo/nanitabeyo
./scripts/apply-migration.sh
```

- `infra/supabase/migrations/` のマイグレーションを適用
- 以下のテーブルが作成・更新される
  - `dish_categories`: origin/cuisine/updated_at/lock_no 削除、synced_at 追加
  - `dish_category_variants`: FK を ON DELETE CASCADE に変更
  - `dish_category_features`: 新規作成
  - `dish_category_localized_text`: 新規作成

### ステップ 2: BigQuery テーブル作成

```bash
cd scripts/20251213T0000_wikidata_food_graph
python3 1_1_create_tables.py
```

- BigQuery migration を実行
- `dish_category_variant_catalog`, `dish_category_images` が作成される

### ステップ 3: Variants 生成

```bash
python3 4_1_generate_variants.py
```

- 既存の `dish_category_catalog` から variants を生成
- 実行時間: 約 5-10 分（データ量により変動）

### ステップ 4: 画像処理

```bash
python3 4_2_process_images.py
```

- 既存の `dish_category_catalog.image_url` から画像候補を処理
- 実行時間: 約 2-5 分（データ量により変動）

### ステップ 5: 同期実行

```bash
export DATABASE_URL="postgresql://user:pass@host:port/dbname?schema=dev"
python3 10_1_sync_bq_to_pg.py
```

- BigQuery → PostgreSQL の完全同期
- 実行時間: 約 10-20 分（データ量により変動）

### ステップ 6: 検証

```bash
# PostgreSQL で確認
psql $DATABASE_URL -c "SELECT COUNT(*) FROM dish_categories;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM dish_category_variants;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM dish_category_features;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM dish_category_localized_text;"

# BigQuery で同期ログを確認
bq query --use_legacy_sql=false \
  "SELECT * FROM \`food-scroll.wikidata_food_graph.pg_sync_logs\` ORDER BY start_time DESC LIMIT 10"
```

## 冪等性

すべてのスクリプトは冪等性を持ち、再実行可能です。

- **BigQuery**: `CREATE OR REPLACE` または `DROP + CREATE` で再生成
- **PostgreSQL**: `INSERT ... ON CONFLICT DO UPDATE` で UPSERT
- **削除**: BigQuery に存在しないカテゴリのみを削除（増分対応）

## 画像優先順位

代表画像の選定は以下の優先順位で行われます：

1. **manual**: 手動でアップロードされた画像
2. **analysis**: 分析ジョブで選定された画像（品質スコア付き）
3. **wikimedia**: Wikidata P18 から取得した画像
4. **partner**: パートナー提供の画像

同じ source_type 内では `score` の降順で選定されます。

## エラーハンドリング

### スクリプトが失敗した場合

1. ログを確認

   ```bash
   # 標準エラー出力を確認
   python3 10_1_sync_bq_to_pg.py 2>&1 | tee sync.log
   ```

2. BigQuery 同期ログを確認

   ```bash
   bq query --use_legacy_sql=false \
     "SELECT * FROM \`food-scroll.wikidata_food_graph.pg_sync_logs\`
      WHERE status = 'error'
      ORDER BY start_time DESC LIMIT 10"
   ```

3. 再実行（冪等性により安全）
   ```bash
   python3 10_1_sync_bq_to_pg.py
   ```

### よくあるエラー

#### `DATABASE_URL not set`

```bash
export DATABASE_URL="postgresql://user:pass@host:port/dbname?schema=dev"
```

#### `Table not found`

BigQuery テーブルが作成されていない可能性があります。

```bash
python3 1_1_create_tables.py
```

#### `FK constraint violation`

PostgreSQL マイグレーションが適用されていない可能性があります。

```bash
./scripts/apply-migration.sh
```

## トラブルシューティング

### CASCADE 削除が動作しない

FK 制約が正しく設定されているか確認：

```sql
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
WHERE tc.table_name IN (
    'dish_category_variants',
    'dish_category_features',
    'dish_category_localized_text'
)
AND tc.constraint_type = 'FOREIGN KEY';
```

期待される出力: `delete_rule` が `CASCADE` であること

### 画像URLが解決されない

`dish_category_images` テーブルにデータが存在するか確認：

```bash
bq query --use_legacy_sql=false \
  "SELECT COUNT(*), source_type
   FROM \`food-scroll.wikidata_food_graph.dish_category_images\`
   GROUP BY source_type"
```

## 依存関係

```bash
# Python パッケージのインストール
pip install -r requirements.txt
```

必要なパッケージ:

- `google-cloud-bigquery>=3.14.1`: BigQuery クライアント
- `psycopg2-binary>=2.9.9`: PostgreSQL クライアント
- `SPARQLWrapper==2.0.0`: Wikidata SPARQL クエリ
- `tenacity==8.2.3`: リトライロジック

## 参考資料

- [Wikidata Query Service](https://query.wikidata.org/)
- [BigQuery Standard SQL](https://cloud.google.com/bigquery/docs/reference/standard-sql)
- [PostgreSQL UPSERT](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)
- [Wikimedia Commons URL structure](https://commons.wikimedia.org/wiki/Commons:File_naming)

## 関連チケット

- #533: Wikidata 料理グラフ構造テーブル作成
- #543: 多言語ラベル・説明・別名の取得
- #548: LLM ラベリング基盤追加
- #557: Region gate 特徴量生成
- #581: 感情訴求型コピー生成
- #585: BQ → PG 同期基盤整備（本チケット）
