# Region Gate Whitelist Batch Labeling

## 概要

このディレクトリには、dish_category_catalog に対して LLM（gpt-4.1-mini）を使って region gate（配信可否ホワイトリスト）を付与するスクリプトが含まれています。

チケット: #557

## 目的

カテゴリレコメンドAPIにおける **region はランキングには一切使わず、配信可否ゲート（ホワイトリスト）としてのみ利用**する。

- `scope:global` と `country:JP` の 2 market で別々に実行
- LLM の判定結果（allow / deny / uncertain）は `wikidata_food_llm_labels` に保存
- **allow & confidence=high のみ**を `dish_category_features_catalog` に自動反映（Precision 最優先）
- `confidence!=high` または `uncertain` は **pass2（再挑戦レーン）候補**として残す

## アーキテクチャ

### モジュール構成

- `region_gate_prompt.py`: market 別 system prompt 生成（scope:global / country:JP で異なる判定基準）
- `region_gate_schema.py`: tool spec 生成と response parser（validation 含む）
- `1_1_export_region_label_targets.py`: ターゲット抽出スクリプト
- `1_2_prepare_region_batch_payload.py`: Batch API payload 生成スクリプト（model: gpt-4.1-mini）
- `1_3_load_region_llm_results.py`: 結果ロードスクリプト
- `1_4_apply_region_llm_results.py`: 特徴量反映スクリプト

### market 別 system prompt の設計思想

#### scope:global

- **"多市場で通る" が根拠**: 地域固有の料理は厳しく判定
- 世界中の多くの市場で日常会話に出てくるもののみ allow
- ローカル固有名詞料理は uncertain/deny 寄せ

#### country:JP

- **"日本語会話で自然" が根拠**: 日本のユーザーが自然に言えるかで判定
- scope:global の "多市場要件" は適用しない
- 日本国内で自然なら allow（地域料理も OK）

## 前提条件

### BigQuery Dataset & Tables

以下の Dataset とテーブルが作成済みであること：

```bash
# Dataset 作成（既に存在する場合は不要）
cd ../../infra/big-query
./20251213T0000_setup_wikidata_food_graph_dataset.sh

# テーブル作成（20251213 migration で作成済み）
# dish_category_catalog
# dish_category_features_catalog（#557 で追加）
# wikidata_food_llm_labels
```

### Python 環境

Python 3.8 以上が必要です：

```bash
python3 --version
```

### 依存パッケージのインストール

```bash
cd scripts/20251213T0000_wikidata_food_graph
pip install -r requirements.txt
```

### GCP 認証

```bash
gcloud auth application-default login
gcloud config set project food-scroll
```

## LLM ラベル定義（region gate）

### decision 定義

- `allow`：当該 market の「何食べよ？」会話で自然に出せる料理カテゴリ/メニュー名
- `deny`：料理カテゴリとして不適（素材・加工品・スプレッド・抽出法・具材・地名/文化名など含む）
- `uncertain`：判断材料不足（confidence は low 寄せ）

### confidence 定義

- `high`：自信あり（自動反映対象）
- `medium`：やや自信あり（手動レビュー対象）
- `low`：自信なし（手動レビュー対象）

### 自動反映ポリシー

- **`allow & confidence=high` のみ自動反映**（Precision 最優先のホワイトリスト運用）
- `confidence!=high` または `uncertain` は pass2（再挑戦レーン）候補として残す

## 使用方法

スクリプトは4つのステップに分かれています。**market ごとに独立して実行**してください。

### ステップ 1: region label targets をエクスポート

dish_category_catalog から対象アイテムを取得し、JSONL でエクスポートします。

```bash
# scope:global
python3 1_1_export_region_label_targets.py --market scope:global

# country:JP
python3 1_1_export_region_label_targets.py --market country:JP
```

**出力:**

- `/tmp/wikidata_food_region_gate/region_targets_scope_global.jsonl`
- `/tmp/wikidata_food_region_gate/region_targets_country_jp.jsonl`

**処理内容:**

- `dish_category_catalog` から `image_url IS NOT NULL` のノードを取得
- market に応じて日本語情報も含める（country:JP の場合）
- 1行1アイテムの JSONL 形式で出力

### ステップ 2: Batch API 用のペイロードを生成

region*targets*\*.jsonl を読み込み、OpenAI Batch API 用のペイロードを生成します。

```bash
# scope:global
python3 1_2_prepare_region_batch_payload.py --market scope:global --run-id 20251218T0000_global_v1

# country:JP
python3 1_2_prepare_region_batch_payload.py --market country:JP --run-id 20251218T0100_jp_v1
```

**出力:**

- `/tmp/wikidata_food_region_gate/batch_payload_scope_global.jsonl`
- `/tmp/wikidata_food_region_gate/batch_payload_country_jp.jsonl`

**処理内容:**

- 20件ずつバッチにまとめる
- market に応じた教師データ（`llm_examples_region_*.json`）を含む system プロンプトを生成
- **market 別の system prompt**: scope:global は多市場基準、country:JP は日本語会話基準
- **tools + tool_choice による構造化出力**で JSON破損を防ぐ
- `temperature=0`, `max_tokens=700`, `model=gpt-4.1-mini`
- Batch API 用の JSONL を生成（1行1リクエスト）

### ステップ 3: OpenAI Batch API でラベリング実行

生成した `batch_payload_*.jsonl` を OpenAI Batch API にアップロードし、ラベリングを実行します。

```bash
# OpenAI CLI を使用する場合
# 1. バッチファイルをアップロード
openai api files.create -f /tmp/wikidata_food_region_gate/batch_payload_scope_global.jsonl -p batch

# 2. バッチを作成
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

# 3. バッチの状態を確認
curl https://api.openai.com/v1/batches/<BATCH_ID> \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json"

# 4. 完了後、結果をダウンロード
curl https://api.openai.com/v1/files/<OUTPUT_FILE_ID>/content \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -o /tmp/wikidata_food_region_gate/results_global.jsonl
```

**注意:**

- Batch API の実行には時間がかかります（通常24時間以内）
- 詳細は [OpenAI Batch API ドキュメント](https://platform.openai.com/docs/guides/batch) を参照

### ステップ 4: LLM 結果を BigQuery にロード

Batch API の結果を BigQuery にロードします。

```bash
# scope:global
python3 1_3_load_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1 --input results_global.jsonl

# country:JP
python3 1_3_load_region_llm_results.py --market country:JP --run-id 20251218T0100_jp_v1 --input results_jp.jsonl
```

**入力:**

- 指定された `--input` ファイル（`/tmp/wikidata_food_region_gate/` 配下）

**処理内容:**

- Batch API のレスポンスをパース
- ロード前検証（件数・順序・enum・maxLength）
- ラベル統計を表示
- `wikidata_food_llm_labels` テーブルにロード（task: `#557_region_scope_global` or `#557_region_country_JP`）

**注意:**

- `--run-id` は実行を識別するための ID です
- 同じ run_id で複数回実行すると重複データが登録されます

### ステップ 5: dish_category_features_catalog に反映

allow & confidence=high のみを dish_category_features_catalog に自動反映します。

```bash
# dry-run モード（実際には反映しない）
python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1 --dry-run

# 実際に反映
python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1
python3 1_4_apply_region_llm_results.py --market country:JP --run-id 20251218T0100_jp_v1
```

**処理内容:**

- `wikidata_food_llm_labels` から `allow & confidence=high` のみ抽出
- `dish_category_features_catalog` に MERGE 反映
  - `feature_type='gate'`
  - `feature_key='region:scope:global'` or `'region:country:JP'`
  - `score=1`
  - `source='llm'`
  - `run_id=<current run_id>`
- 過分削除：同一 `run_id / market / feature_key` で今回 allow/high に含まれない item は削除

## 処理フロー

```
ステップ 1: region label targets をエクスポート
↓
dish_category_catalog から取得（image_url IS NOT NULL）
↓
/tmp/wikidata_food_region_gate/region_targets_*.jsonl に保存

ステップ 2: Batch API 用のペイロードを生成
↓
20件ずつバッチに分割
↓
market 別の教師データを含む system プロンプトを生成
↓
tools + tool_choice で構造化出力（JSON破損対策）
↓
/tmp/wikidata_food_region_gate/batch_payload_*.jsonl に保存

ステップ 3: OpenAI Batch API でラベリング実行（手動）
↓
batch_payload_*.jsonl をアップロード
↓
Batch API で処理（通常24時間以内）
↓
results_*.jsonl をダウンロード

ステップ 4: LLM 結果を BigQuery にロード
↓
results_*.jsonl をパース＋検証
↓
wikidata_food_llm_labels テーブルにロード

ステップ 5: dish_category_features_catalog に反映
↓
allow & confidence=high のみ抽出
↓
dish_category_features_catalog に MERGE 反映＋過分削除
```

## コスト見積もり

gpt-4o-mini + Batch API を利用することで、コストを大幅に削減できます。

### 見積もり条件

- 対象ノード数: 約 13,888 件（dish_category_catalog 全件想定）
- バッチサイズ: 20件 / リクエスト
- リクエスト数: 約 695 件
- 平均トークン数（入力）: 約 1,500 トークン / リクエスト（examples 簡素化）
- 平均トークン数（出力）: 約 800 トークン / リクエスト（20件 × 約40トークン/件）

### 料金（2024年12月時点）

- gpt-4o-mini Batch API:
  - 入力: $0.075 / 1M トークン（通常の50%割引）
  - 出力: $0.30 / 1M トークン（通常の50%割引）

### 計算（1 market あたり）

- 入力トークン: 1,500 × 695 = 1.04M → $0.078
- 出力トークン: 800 × 695 = 0.556M → $0.167
- **合計: 約 $0.245 / market**

### 2 market 合計

- **合計: 約 $0.49**

## 注意事項

### 初回実行時の確認事項

1. **必ず dry-run で確認する**

   ```bash
   python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v1 --dry-run
   ```

2. **サンプリングして目視確認する**

   ```sql
   SELECT *
   FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
   WHERE task = '#557_region_scope_global'
     AND run_id = '20251218T0000_global_v1'
     AND label = 'allow'
     AND confidence = 'high'
   LIMIT 100;
   ```

3. **明らかに間違っているケースがあれば**
   - `llm_examples_region_*.json` に例を追加
   - 新しい run_id で再実行

### decision の扱い

- `allow` → dish_category_features_catalog に反映（confidence=high のみ）
- `deny` → 反映しない
- `uncertain` → 反映しない（pass2 候補）

### confidence の扱い

- `high` → 自動で dish_category_features_catalog に反映
- `medium` / `low` → 自動反映しない（必要に応じて人手でレビュー）

### 複数回実行する場合

- 同じ run_id で複数回実行すると重複データが登録されます
- プロンプトを微調整して再実行する場合は、必ず新しい run_id を使用してください

  ```bash
  python3 1_2_prepare_region_batch_payload.py --market scope:global --run-id 20251218T0000_global_v2
  python3 1_3_load_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v2 --input results_global_v2.jsonl
  python3 1_4_apply_region_llm_results.py --market scope:global --run-id 20251218T0000_global_v2
  ```

## 作成される BigQuery テーブル

### wikidata_food_llm_labels

LLM ラベリング結果を保持するテーブル（既存、#548 で作成済み）。

**カラム:**

- `item_qid`: Wikidata QID
- `task`: タスク識別子（例: '#557_region_scope_global', '#557_region_country_JP'）
- `label`: decision（'allow' / 'deny' / 'uncertain'）
- `confidence`: 信頼度（'high' / 'medium' / 'low'）
- `reason`: LLM の説明（英語）
- `model`: モデル名（'gpt-4.1-mini'）
- `run_id`: バッチ実行ごとの識別子
- `created_at`: 登録日時

### dish_category_features_catalog

region gate feature を保持するテーブル（#557 で追加）。

**カラム:**

- `item_qid`: dish_category QID
- `feature_type`: 'gate' | 'mood' | 'scene' | 'timeSlot' | 'taste' | 'archetype' ...
- `feature_key`: 'region:scope:global', 'region:country:JP', ...
- `score`: gate は 1 固定
- `source`: 'llm' | 'manual' | 'rule'
- `run_id`: LLM run 識別子
- `updated_at`: 最終更新日時
- `note`: 任意メモ（confidence / short reason 等）

## BigQuery での確認方法

### ラベリング結果の確認

```sql
-- decision ごとの件数
SELECT
  label AS decision,
  confidence,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task = '#557_region_scope_global'
  AND run_id = '20251218T0000_global_v1'
GROUP BY label, confidence
ORDER BY label, confidence;

-- サンプル確認
SELECT
  item_qid,
  label AS decision,
  confidence,
  reason
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task = '#557_region_scope_global'
  AND run_id = '20251218T0000_global_v1'
  AND label = 'allow'
  AND confidence = 'high'
LIMIT 10;
```

### dish_category_features_catalog への反映確認

```sql
-- region gate feature の件数
SELECT
  feature_key,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
WHERE feature_type = 'gate'
  AND run_id = '20251218T0000_global_v1'
GROUP BY feature_key
ORDER BY feature_key;

-- サンプル確認
SELECT
  fc.item_qid,
  fc.feature_key,
  fc.score,
  fc.note,
  cat.label_en,
  cat.desc_en
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog` AS fc
JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` AS cat
  ON fc.item_qid = cat.item_qid
WHERE fc.feature_type = 'gate'
  AND fc.run_id = '20251218T0000_global_v1'
LIMIT 10;
```

## トラブルシューティング

### BigQuery への認証エラー

```bash
# GCP 認証を再実行
gcloud auth application-default login
gcloud config set project food-scroll
```

### results.jsonl が見つからない

```bash
# Batch API の結果をダウンロード
openai api files.content --file-id file-yyy > /tmp/wikidata_food_region_gate/results_global.jsonl
```

### テーブルが作成されない

```bash
# migration を手動で実行
cd ../../infra/big-query/migration
sed 's/${DATASET}/food-scroll.wikidata_food_graph/g' 20251213T0000_create_wikidata_food_tables.sql | bq query --use_legacy_sql=false
```

## ファイル構成

```
scripts/20251213T0000_wikidata_food_graph/557_region_gate/
├── region_gate_prompt.py                    # system prompt 生成（market 別）
├── region_gate_schema.py                    # tool spec と response parser
├── 1_1_export_region_label_targets.py       # ステップ1: ノードエクスポート
├── 1_2_prepare_region_batch_payload.py      # ステップ2: ペイロード生成（gpt-4.1-mini）
├── 1_3_load_region_llm_results.py           # ステップ4: BigQuery ロード
├── 1_4_apply_region_llm_results.py          # ステップ5: dish_category_features_catalog 更新
├── llm_examples_region_global.json          # 教師データ（scope:global 用、17件）
├── llm_examples_region_country_jp.json      # 教師データ（country:JP 用、16件）
└── README.md                                # このファイル
```

## 関連ドキュメント

- [infra/big-query/README.md](../../../infra/big-query/README.md): BigQuery インフラストラクチャ全体の説明
- [infra/big-query/migration/20251213T0000_create_wikidata_food_tables.sql](../../../infra/big-query/migration/20251213T0000_create_wikidata_food_tables.sql): テーブル定義 SQL
- [scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/README.md](../548_wikidata_food_llm_labeling/README.md): menu_blacklist LLM ラベリング基盤

## 関連チケット

- #557: region ホワイトリスト一括付与（LLMバッチ）
- #548: Wikidata 食品ノードへの LLM ラベリング基盤追加（dish_blacklist 強化）
- #550: macro_genre LLM ラベリング
- #543: dish_category_catalog 全言語情報追加
