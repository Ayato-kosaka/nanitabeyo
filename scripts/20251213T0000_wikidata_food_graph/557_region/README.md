# region ホワイトリスト一括付与（LLMバッチ）

## 概要

このディレクトリには、region ホワイトリストを LLM で一括付与するためのスクリプトが含まれています。

チケット: #557

## 目的

カテゴリレコメンド API における region は**ランキングに使わず、配信可否ゲート（ホワイトリスト）**としてのみ利用します。

`dish_category_catalog`（blacklist 除外済み準マスタ）を対象に、LLM で以下の2つの market を**別 run で2回**ラベリングし、結果を `dish_category_features_catalog` に MERGE で反映します。

- `scope:global`
- `country:JP`

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
- `dish_root_summary`
- `wikidata_food_llm_labels`
- `dish_category_features_catalog`（#557 で追加）

親ディレクトリのスクリプト（1_1, 1_2, 1_3, 3_1）を実行して、これらのテーブルを作成してください。

## 使用方法

スクリプトは4つのステップに分かれています。market ごとに順番に実行してください。

### ステップ 1: ターゲットアイテムのエクスポート

dish_category_catalog から全アイテムを JSONL でエクスポート。

```bash
# scope:global 用
python3 1_1_export_region_label_targets.py --market scope:global

# country:JP 用
python3 1_1_export_region_label_targets.py --market country:JP
```

**処理内容:**

- `dish_category_catalog` の全アイテムを取得
- market に応じて label/desc を優先的に使用
- roots（dish/dessert/drink）と tags（depth<=5、最大10件）を付与
- JSONL 形式で出力

**出力:**

- `/tmp/wikidata_food_region/region_targets_scope_global.jsonl`
- `/tmp/wikidata_food_region/region_targets_country_jp.jsonl`

### ステップ 2: Batch ペイロードの生成

LLM Batch API 用のリクエストペイロードを生成。

```bash
# scope:global 用
python3 1_2_prepare_region_batch_payload.py --market scope:global --run-id 20251218T0000_global_v1

# country:JP 用
python3 1_2_prepare_region_batch_payload.py --market country:JP --run-id 20251218T0100_jp_v1
```

**処理内容:**

- targets JSONL を読み込み
- 20件ずつバッチにまとめる
- market に応じた教師データを使用（`llm_examples_region_<market>.json`）
- OpenAI Batch API 用の JSONL を生成

**出力:**

- `/tmp/wikidata_food_region/batch_payload_scope_global.jsonl`
- `/tmp/wikidata_food_region/batch_payload_country_jp.jsonl`

### ステップ 3: （外部）Batch 実行

OpenAI Batch API にアップロード・実行・ダウンロードは**手動**で行います。

```bash
# ファイルをアップロード
openai api files.create -f /tmp/wikidata_food_region/batch_payload_scope_global.jsonl -p batch

# Batch を作成
curl https://api.openai.com/v1/batches \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input_file_id": "file-xxx",
    "endpoint": "/v1/chat/completions",
    "completion_window": "24h",
    "metadata": {
      "task": "#557_region_scope_global",
      "run_id": "20251218T0000_global_v1"
    }
  }'

# Batch のステータスを確認
curl https://api.openai.com/v1/batches/batch_xxxxxx \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# 結果をダウンロード
curl https://api.openai.com/v1/files/<OUTPUT_FILE_ID>/content \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -o /tmp/wikidata_food_region/results_global.jsonl
```

### ステップ 4: Batch 結果のロード

OpenAI Batch API からダウンロードした結果を BigQuery にロード。

```bash
# scope:global 用
python3 1_3_load_region_llm_results.py \
  --market scope:global \
  --run-id 20251218T0000_global_v1 \
  --input /tmp/wikidata_food_region/results_global.jsonl

# country:JP 用
python3 1_3_load_region_llm_results.py \
  --market country:JP \
  --run-id 20251218T0100_jp_v1 \
  --input /tmp/wikidata_food_region/results_jp.jsonl
```

**処理内容:**

- Batch API の結果ファイル（JSONL）を読み込み
- LLMClient でレスポンスをパース
- `wikidata_food_llm_labels` テーブルにロード
  - task=`#557_region_scope_global` or `#557_region_country_JP`
  - decision（allow/deny/uncertain）を label カラムに保存

### ステップ 5: LLM 結果の適用

LLM 分類結果を dish_category_features_catalog に MERGE 反映。

```bash
# 統計情報の確認（dry-run）
python3 1_4_apply_region_llm_results.py \
  --market scope:global \
  --run-id 20251218T0000_global_v1 \
  --dry-run

# 実際に適用
python3 1_4_apply_region_llm_results.py \
  --market scope:global \
  --run-id 20251218T0000_global_v1

# country:JP も同様に
python3 1_4_apply_region_llm_results.py \
  --market country:JP \
  --run-id 20251218T0100_jp_v1
```

**処理内容:**

- decision='allow' かつ confidence='high' を dish_category_features_catalog に MERGE
- feature_type='region', feature_key=`<market>`, score=1, source='llm'
- 過分削除：今回の allow/high に含まれない item を削除（同 run_id/market のみ）

**適用後の確認:**

```bash
# region features の件数確認
bq query --use_legacy_sql=false \
  "SELECT feature_key, COUNT(*) as count FROM \`food-scroll.wikidata_food_graph.dish_category_features_catalog\` WHERE feature_type='region' GROUP BY feature_key ORDER BY count DESC"

# 具体的な region features を確認
bq query --use_legacy_sql=false \
  "SELECT * FROM \`food-scroll.wikidata_food_graph.dish_category_features_catalog\` WHERE feature_type='region' LIMIT 10"
```

## LLM ラベリング仕様

### 対象

`dish_category_catalog` に存在する `item_qid` 全件

### 2回実施

- Run1：`scope:global`
- Run2：`country:JP`

### decision 定義

- `allow`：当該 market で「何食べよ？」会話に登場する粒度として実在感があり、カテゴリ候補として配信してよい
- `deny`：当該 market では実在感が薄い / 会話に登場しない / そもそも料理カテゴリとして不適
- `uncertain`：判断材料不足（confidence 低に寄せる）

### confidence

- `high | medium | low`

### reason

- 短い根拠（英語推奨、最大1文、120文字以内）

## 教師データ

配置：

- `llm_examples_region_global.json`（30件、scope:global 用）
- `llm_examples_region_country_jp.json`（30件、country:JP 用）

方針：

- market 別に examples を分ける（精度重視）
- allow/deny の境界事例を多めに
- "ローカルすぎる料理名""cuisine名""調理法""食材""地域名"などを deny に寄せる例を含める

## BigQuery テーブル

### dish_category_features_catalog

#557 で追加されたテーブル。PostgreSQL の `dish_category_features` と同形をベースに、運用メタを+α。

**カラム:**

- `item_qid`: dish QID
- `feature_type`: 'region' | 'mood' | 'scene' | 'timeSlot' | 'taste' | 'archetype' ...
- `feature_key`: 'country:JP', 'scope:global', ...
- `score`: region は 1 固定
- `source`: 'llm' | 'manual' | 'rule'
- `run_id`: LLM batch 実行 ID
- `updated_at`: 更新日時
- `note`: 任意（confidence や短い reason）

### wikidata_food_llm_labels

既存テーブル（#548, #550 と共用）。task カラムで区別。

**region 用の task:**

- `#557_region_scope_global`
- `#557_region_country_JP`

## 運用フロー

### 初回実行

```bash
# 1. scope:global のエクスポート
python3 1_1_export_region_label_targets.py --market scope:global

# 2. scope:global のペイロード生成
python3 1_2_prepare_region_batch_payload.py --market scope:global --run-id 20251218T0000_global_v1

# 3. （手動）Batch API にアップロード・実行・ダウンロード

# 4. scope:global の結果ロード
python3 1_3_load_region_llm_results.py \
  --market scope:global \
  --run-id 20251218T0000_global_v1 \
  --input /tmp/wikidata_food_region/results_global.jsonl

# 5. scope:global の適用
python3 1_4_apply_region_llm_results.py \
  --market scope:global \
  --run-id 20251218T0000_global_v1

# 6. country:JP も同様に実施（run_id は別にする）
python3 1_1_export_region_label_targets.py --market country:JP
python3 1_2_prepare_region_batch_payload.py --market country:JP --run-id 20251218T0100_jp_v1
# （手動 Batch API）
python3 1_3_load_region_llm_results.py \
  --market country:JP \
  --run-id 20251218T0100_jp_v1 \
  --input /tmp/wikidata_food_region/results_jp.jsonl
python3 1_4_apply_region_llm_results.py \
  --market country:JP \
  --run-id 20251218T0100_jp_v1
```

### 再実行（プロンプト調整後など）

新しい run_id で実行すれば、古いデータは残したまま新しいデータを追加できます。

```bash
# 新しい run_id で再実行
python3 1_2_prepare_region_batch_payload.py --market scope:global --run-id 20251218T0200_global_v2
# （Batch API 実行）
python3 1_3_load_region_llm_results.py --market scope:global --run-id 20251218T0200_global_v2 --input results_v2.jsonl
python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0200_global_v2
```

## トラブルシューティング

### LLM のレスポンスが不正

- `1_3_load_region_llm_results.py` のログでパースエラーを確認
- 教師データ（`llm_examples_region_*.json`）を調整
- プロンプト（`llm_client.py` の `_build_system_message_region()`）を調整
- 新しい run_id で再実行

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
sed 's/${DATASET}/food-scroll.wikidata_food_graph/g' 20251213T0000_create_wikidata_food_tables.sql | bq query --use_legacy_sql=false
```

## ファイル構成

```
scripts/20251213T0000_wikidata_food_graph/557_region/
├── 1_1_export_region_label_targets.py        # ステップ1: ターゲットエクスポート
├── 1_2_prepare_region_batch_payload.py       # ステップ2: Batch ペイロード生成
├── 1_3_load_region_llm_results.py            # ステップ4: 結果ロード
├── 1_4_apply_region_llm_results.py           # ステップ5: 結果適用
├── llm_examples_region_global.json           # 教師データ（scope:global用、30件）
├── llm_examples_region_country_jp.json       # 教師データ（country:JP用、30件）
└── README.md                                 # このファイル
```

## 注意事項

- スクリプトは親ディレクトリの `loader_bigquery.py` と `llm_client.py` を利用します
- 各ステップは独立しているため、失敗した場合はそのステップから再実行できます
- OpenAI Batch API の実行は手動で行う必要があります（コスト制御のため）
- このスクリプトは PostgreSQL の `dish_category_features` を更新しません（別チケット対応）
- プロジェクト（food-scroll）とデータセット（wikidata_food_graph）は固定値です
- 自動反映対象は原則 `decision='allow' AND confidence='high'` のみ

## 次のステップ

1. BigQuery でデータを確認する
2. 結果を PostgreSQL の `dish_category_features` に反映する（別チケット）
3. カテゴリレコメンド API で region フィルタリングを実装する（別チケット）

## 関連ドキュメント

- [親ディレクトリ README](../README.md): Wikidata 食品グラフ抽出スクリプト全体の説明
- [infra/big-query/migration/20251213T0000_create_wikidata_food_tables.sql](../../../infra/big-query/migration/20251213T0000_create_wikidata_food_tables.sql): テーブル定義 SQL

## 関連チケット

- #557: region ホワイトリスト一括付与（LLMバッチ）
- #548: Wikidata 食品ノードへの LLM ラベリング基盤追加（dish_blacklist 強化）
- #550: macro_genre（Wikidata）ホワイトリスト運用＋割当結果テーブル作成（BigQuery）
- #533: Wikidata 由来の料理・飲み物グラフ構造テーブル作成（BigQuery）
