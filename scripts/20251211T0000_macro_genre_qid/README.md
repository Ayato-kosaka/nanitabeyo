# macro_genre_qid 付与バッチスクリプト

## 概要

このディレクトリには、dish_categories に macro_genre_qid を付与するためのバッチスクリプトが含まれています。

チケット: #533

## 目的

カテゴリレコメンドAPIでスレート多様性制御のために、各 dish_category を粗い料理枠（macro_genre）にマッピングします。

Wikidata の生グラフをオンラインで辿るのではなく、以下の3ステップでオフライン処理を行います：

1. **1_1_fetch_ancestors.py**: dish_categories の QID から P31/P279 を再帰的に取得し ancestor をテーブルに保存
2. **1_2_export_ancestor_stats.py**: ancestor の分布を目検し macro_genre ホワイトリストを作成するための材料を出力
3. **1_3_assign_macro_genre.py**: BFS（最短ヒット）で macro_genre_qid を一括更新

## 前提条件

### データベース

以下のマイグレーションを適用済みであること：

- `infra/supabase/migrations/20251211T0000_add_macro_genre_qid.sql`

このマイグレーションにより以下が作成されます：

- `dish_categories.macro_genre_qid` カラム
- `dish_category_ancestors` テーブル
- `macro_genre_whitelist` テーブル

### Python 環境

```bash
# Python 3.8 以上が必要
python3 --version

# 依存パッケージのインストール
pip install -r requirements.txt
```

### 環境変数

DATABASE_URL 環境変数が必要です：

```bash
export DATABASE_URL="postgresql://user:pass@host:port/dbname?schema=dev"
```

## 使用方法

### ステップ 1: ancestor の収集

dish_categories から Wikidata SPARQL で ancestor を取得します。

```bash
python3 1_1_fetch_ancestors.py
```

**注意点:**

- SPARQL endpoint への大量リクエストが発生するため、実行には時間がかかります（数百件で数時間程度）
- rate limit 対策として retry/backoff が実装されていますが、失敗したバッチはスキップされます
- 再実行することで、スキップされたデータを再取得できます
- `dish_category_ancestors` テーブルは TRUNCATE されてから再INSERT されます

**処理内容:**

- dish_categories を 100件ずつバッチ処理
- 各 dish について P31 (instance of) と P279 (subclass of) を BFS で depth 4 まで辿る
- 結果を `dish_category_ancestors` テーブルに保存

### ステップ 2: 統計の出力とホワイトリスト作成

ancestor の統計を CSV に出力します。

```bash
python3 1_2_export_ancestor_stats.py
```

**出力ファイル:** `macro_genre_candidate_stats.csv`

**CSV のカラム:**

- `ancestor_qid`: Wikidata QID
- `label_en`: 英語ラベル
- `label_ja`: 日本語ラベル
- `dish_count`: この ancestor を持つ dish_category の数
- `sample_dishes`: 代表的な dish_category のラベル（最大5件）

**次のアクション:**

1. CSV を確認し、macro_genre として使いたい QID を選定
2. 選定した QID を `macro_genre_whitelist` テーブルに INSERT

例：

```sql
INSERT INTO macro_genre_whitelist (macro_genre_qid, label_en, label_ja) VALUES
  ('Q4939235', 'noodle soup', '麺類のスープ'),
  ('Q179448', 'nabemono', '鍋物'),
  ('Q847',     'teppanyaki', '鉄板焼き'),
  ('Q13184',   'curry', 'カレー'),
  ('Q753',     'sushi', '寿司'),
  ('Q13276',   'cake', 'ケーキ'),
  ('Q179731',  'sashimi', '刺身');
```

### ステップ 3: macro_genre_qid の付与

ホワイトリストに基づいて macro_genre_qid を決定し、dish_categories を更新します。

```bash
# Dry run モード（実際の更新は行わない）
python3 1_3_assign_macro_genre.py --dry-run

# 実際に更新
python3 1_3_assign_macro_genre.py

# macro_genre_qid が NULL のもののみ処理
python3 1_3_assign_macro_genre.py --only-null
```

**オプション:**

- `--dry-run`: 実際の UPDATE を行わず、差分だけログ出力
- `--only-null`: macro_genre_qid が NULL のもののみ処理

**処理内容:**

- 各 dish_category について、ancestors を depth 昇順で取得
- 最初に whitelist にマッチした ancestor_qid を macro_genre_qid に採用
- 同一 depth で複数マッチする場合（ambiguous）は、ログに出力し NULL のまま

**ambiguous ケースについて:**

同一 depth で複数の whitelist QID にマッチする場合、自動では決定できません。ログに出力されるので、以下のいずれかで対応してください：

1. ホワイトリストを調整（より具体的な QID を追加、または粗すぎる QID を削除）
2. 手動で SQL UPDATE

## ロールバック

テーブルを削除する場合：

```sql
ALTER TABLE dish_categories DROP COLUMN IF EXISTS macro_genre_qid;
DROP TABLE IF EXISTS dish_category_ancestors;
DROP TABLE IF EXISTS macro_genre_whitelist;
```

## トラブルシューティング

### SPARQL endpoint がタイムアウトする

`1_1_fetch_ancestors.py` の `BATCH_SIZE` を小さくしてください（デフォルト 100 → 50 など）。

### rate limit に引っかかる

スクリプトには retry/backoff が実装されていますが、それでも失敗する場合は：

- スクリプトを複数回に分けて実行
- `MAX_DEPTH` を小さくする（デフォルト 4 → 3 など）

### ancestor が見つからない dish がある

dish_category の QID が Wikidata に存在しない、または P31/P279 が定義されていない可能性があります。これらは別途手動対応が必要です。

### macro_genre_qid が決まらない dish がある

whitelist に該当する ancestor が含まれていません。以下を確認：

1. `1_2_export_ancestor_stats.py` の出力を見て、該当 dish の ancestor を確認
2. 適切な macro_genre を whitelist に追加

## 参考

### 使用する Wikidata プロパティ

- **P31 (instance of)**: そのアイテムが何であるか
- **P279 (subclass of)**: そのクラスが何のサブクラスか

**使用しないプロパティ（今回のスコープ外）:**

- P527 (has part(s))
- P361 (part of)

### BFS の深さ

- depth 0: dish 自身
- depth 1: dish の P31/P279 先
- depth 2-4: さらにその親

最大 depth は `MAX_DEPTH` で設定（デフォルト 4）。

## 補足

- これらのスクリプトは冪等ではありません（`1_1_fetch_ancestors.py` は TRUNCATE + INSERT）
- 本番環境での実行前に、必ず開発環境でテストしてください
- 大量の Wikidata SPARQL リクエストが発生するため、実行タイミングに注意してください
