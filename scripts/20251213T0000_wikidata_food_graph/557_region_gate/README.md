# Region Gate (Whitelist) - LLM ラベリング基盤

## 概要

このディレクトリには、`dish_category_catalog` の全アイテムに対して LLM（gpt-4o-mini）を使って region 判定を行い、`dish_category_features_catalog` に **region gate feature（ホワイトリスト）** を反映するスクリプトが含まれています。

チケット: #557

## 目的

カテゴリレコメンド API における **region はランキングには一切使わず、配信可否ゲート（ホワイトリスト）としてのみ利用**する。

Wikidata 由来の `dish_category_catalog`（blacklist 除外済み準マスタ）を対象に、LLM による region 判定を以下の **2 market で別 run** で実施する：

- `scope:global`
- `country:JP`

LLM の判定結果は既存の `wikidata_food_llm_labels` に保存する。

将来の PostgreSQL 投入・監査・差分比較を見据え、BigQuery に **ゲート用途専用の特徴量テーブル** `dish_category_features_catalog` を用意し、`feature_type='gate'` / `feature_key='region:...'` として **MERGE 反映**する。

## ゴール

1. `dish_category_catalog.item_qid` 全件を対象に、LLM による region 判定を
   - `scope:global`（1回）
   - `country:JP`（1回）
   で実施でき、結果が `wikidata_food_llm_labels` に保存される

2. LLM 結果（task / run_id 指定）から `dish_category_features_catalog` に **region gate feature** を生成し、自動反映できる

3. **自動反映対象は原則 `decision='allow' AND confidence='high'` のみ**（Precision 最優先のホワイトリスト運用、ポリシー固定）

4. `confidence!=high` または `uncertain` は **pass2（再挑戦レーン）候補**として残し、pass1 では反映しない

5. Ayato-kosaka/nanitabeyo#548 流儀（export → batch payload → load results → apply）で再実行可能・監査可能な運用ができる

## 前提条件

### BigQuery Dataset & Tables

以下の Dataset とテーブルが作成済みであること：

```bash
# Dataset 作成（既に存在する場合は不要）
cd ../../infra/big-query
./20251213T0000_setup_wikidata_food_graph_dataset.sh

# テーブル作成（20251213 migration で作成済み）
# dish_category_features_catalog テーブルが追加されていることを確認
```

これにより以下のテーブルが利用可能になります：

- `food-scroll.wikidata_food_graph.dish_category_catalog`
- `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
- `food-scroll.wikidata_food_graph.dish_category_features_catalog` (新規)

### Python 環境

Python 3.8 以上が必要です：

```bash
python3 --version
```

### 依存パッケージのインストール

```bash
pip install -r ../requirements.txt
```

### GCP 認証

```bash
gcloud auth application-default login
gcloud config set project food-scroll
```

### OpenAI API キー

環境変数に OpenAI API キーを設定してください：

```bash
export OPENAI_API_KEY="sk-..."
```

## LLM ラベリング仕様（region gate）

### 対象

- `dish_category_catalog` に存在する `item_qid` 全件（blacklist 除外済み前提）

### 実施 run

- Run1：`scope:global`
- Run2：`country:JP`

※ market を混ぜない（精度・再現性重視）

### decision 定義

- `allow`
  当該 market において「何食べよ？」会話に登場する **料理カテゴリ／メニュー名として実在感があり、配信してよい**

- `deny`
  当該 market では実在感が薄い、または 食材・調理法・地名・文化名などで **料理カテゴリとして不適**

- `uncertain`
  判断材料不足（confidence は low 寄せ）

### confidence

- `high | medium | low`

### reason

- 短い根拠（英語推奨、最大1文）

## LLM 入力（catalog から生成）

`dish_category_catalog` から以下を用いて **短く固定フォーマットの evidence** を Python で生成する：

使用候補カラム：

- `item_qid`
- `label_en`, `desc_en`
- `label_ja`, `desc_ja`（JP run では優先）
- `aliases_json`（代表数件のみ）
- `sitelinks_json`（jawiki / enwiki の有無のみ）
- `roots`
- `tags`（depth<=5 の ancestor QID、最大 N 件）

> 全部渡さず、**LLM に見せる情報量を意図的に制限**する（安定性・コスト・ブレ対策）

## 教師データ（few-shot）

配置：

```
scripts/20251213T0000_wikidata_food_graph/557_region_gate/
  llm_examples_region_global.json
  llm_examples_region_country_jp.json
```

方針：

- 各 40 件
- market ごとに完全分離
- allow / deny の境界事例を多めに
- 食材・調理法・地名・料理文化名など **deny になりやすい型を厚めに含める**

## 使用方法

スクリプトは4つのステップに分かれています。順番に実行してください。

### ステップ 1: region label targets をエクスポート

BigQuery から dish_category_catalog の全アイテムを取得し、JSONL でエクスポートします。

```bash
# scope:global 用
python3 1_1_export_region_label_targets.py --market scope:global

# country:JP 用
python3 1_1_export_region_label_targets.py --market country:JP
```

**出力:**

- `/tmp/wikidata_food_region/region_targets_scope_global.jsonl`
- `/tmp/wikidata_food_region/region_targets_country_jp.jsonl`

### ステップ 2: Batch API 用のペイロードを生成

targets JSONL を読み込み、OpenAI Batch API 用のペイロードを生成します。

```bash
# scope:global 用
python3 1_2_prepare_region_batch_payload.py \
  --market scope:global \
  --run_id 20251218T0000_global_v1

# country:JP 用
python3 1_2_prepare_region_batch_payload.py \
  --market country:JP \
  --run_id 20251218T0100_jp_v1
```

**出力:**

- `/tmp/wikidata_food_region/batch_payload_scope_global_<run_id>.jsonl`
- `/tmp/wikidata_food_region/batch_payload_country_jp_<run_id>.jsonl`

### ステップ 3: OpenAI Batch API でラベリング実行

生成した `batch_payload.jsonl` を OpenAI Batch API にアップロードし、ラベリングを実行します。

```bash
# 1. バッチファイルをアップロード
curl https://api.openai.com/v1/files \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F purpose="batch" \
  -F file="@/tmp/wikidata_food_region/batch_payload_scope_global_20251218T0000_global_v1.jsonl"

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
  -H "Authorization: Bearer $OPENAI_API_KEY"

# 4. 完了後、結果をダウンロード
curl https://api.openai.com/v1/files/<OUTPUT_FILE_ID>/content \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -o /tmp/wikidata_food_region/results_global.jsonl
```

**注意:**

- Batch API の実行には時間がかかります（通常24時間以内）
- 詳細は [OpenAI Batch API ドキュメント](https://platform.openai.com/docs/guides/batch) を参照

### ステップ 4: LLM 結果を BigQuery にロード

Batch API の結果を BigQuery にロードします。

```bash
# scope:global 用
python3 1_3_load_region_llm_results.py \
  --market scope:global \
  --run_id 20251218T0000_global_v1 \
  --input /tmp/wikidata_food_region/results_global.jsonl

# country:JP 用
python3 1_3_load_region_llm_results.py \
  --market country:JP \
  --run_id 20251218T0100_jp_v1 \
  --input /tmp/wikidata_food_region/results_jp.jsonl
```

**処理内容:**

- Batch API のレスポンスをパース
- ラベル統計を表示
- `wikidata_food_llm_labels` テーブルにロード

### ステップ 5: LLM ラベルに基づき features catalog を更新

confidence='high' かつ decision='allow' のアイテムを dish_category_features_catalog に反映します。

```bash
# dry-run モード（実際には反映しない）
python3 1_4_apply_region_llm_results.py \
  --market scope:global \
  --run_id 20251218T0000_global_v1 \
  --dry-run

# 実際に反映
python3 1_4_apply_region_llm_results.py \
  --market scope:global \
  --run_id 20251218T0000_global_v1

python3 1_4_apply_region_llm_results.py \
  --market country:JP \
  --run_id 20251218T0100_jp_v1
```

**処理内容:**

- `wikidata_food_llm_labels` から統計情報を取得
- `decision='allow'` かつ `confidence='high'` のみを抽出
- `dish_category_features_catalog` に MERGE 反映（過分削除含む）

## 処理フロー

```
ステップ 1: region label targets をエクスポート
↓
BigQuery から dish_category_catalog を取得
↓
/tmp/wikidata_food_region/region_targets_*.jsonl に保存

ステップ 2: Batch API 用のペイロードを生成
↓
20件ずつバッチに分割
↓
market ごとに system prompt / examples を切り替え
↓
/tmp/wikidata_food_region/batch_payload_*.jsonl に保存

ステップ 3: OpenAI Batch API でラベリング実行（手動）
↓
batch_payload.jsonl をアップロード
↓
Batch API で処理（通常24時間以内）
↓
results.jsonl をダウンロード

ステップ 4: LLM 結果を BigQuery にロード
↓
results.jsonl をパース
↓
wikidata_food_llm_labels テーブルにロード

ステップ 5: features catalog を更新
↓
allow & confidence=high のみを抽出
↓
dish_category_features_catalog に MERGE 反映（過分削除含む）
```

## 作成される BigQuery テーブル

### dish_category_features_catalog（新規）

Region gate feature を保存するテーブル。

**カラム:**

- `item_qid`: Wikidata QID
- `feature_type`: 'gate' | 'mood' | 'scene' | 'timeSlot' | 'taste' | 'archetype'
- `feature_key`: 'region:scope:global', 'region:country:JP', ...
- `score`: gate は 1 固定
- `source`: 'llm' | 'manual' | 'rule'
- `run_id`: LLM 実行の識別子
- `updated_at`: 更新日時
- `note`: 任意（confidence / short reason 等）

### wikidata_food_llm_labels（既存）

LLM ラベリング結果を保持するテーブル。

region 判定結果を **task / run_id / market 別**に保存する。

## BigQuery での確認方法

### region gate features の確認

```sql
-- feature_type='gate' の件数
SELECT
  feature_key,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
WHERE feature_type = 'gate'
GROUP BY feature_key
ORDER BY feature_key;

-- サンプル確認
SELECT *
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
WHERE feature_type = 'gate'
  AND feature_key = 'region:scope:global'
LIMIT 10;
```

### LLM ラベリング結果の確認

```sql
-- ラベルごとの件数
SELECT
  task,
  label,
  confidence,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task LIKE '#557%'
GROUP BY task, label, confidence
ORDER BY task, label, confidence;

-- サンプル確認
SELECT *
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task = '#557_region_scope_global'
  AND label = 'allow'
  AND confidence = 'high'
LIMIT 10;
```

## 注意事項

### 初回実行時の確認事項

1. **必ず dry-run で確認する**

   ```bash
   python3 1_4_apply_region_llm_results.py \
     --market scope:global \
     --run_id 20251218T0000_global_v1 \
     --dry-run
   ```

2. **サンプリングして目視確認する**

   ```sql
   SELECT *
   FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
   WHERE task = '#557_region_scope_global'
     AND label = 'allow'
     AND confidence = 'high'
   LIMIT 100;
   ```

3. **明らかに間違っているケースがあれば**
   - 教師データ（`llm_examples_region_*.json`）に例を追加
   - system プロンプト（`1_2_prepare_region_batch_payload.py`）を微調整
   - 新しい run_id で再実行

### decision の扱い

- `allow` → dish_category_features_catalog に反映（confidence=high のみ）
- `deny` → 反映しない
- `uncertain` → 自動反映しない（別途レビュー対象 / pass2 候補）

### confidence の扱い

- `high` → 自動で dish_category_features_catalog に反映
- `medium` / `low` → 自動反映しない（必要に応じて人手でレビュー / pass2 候補）

### 複数回実行する場合

- 同じ run_id で複数回実行すると重複データが登録されます
- プロンプトを微調整して再実行する場合は、必ず新しい run_id を使用してください

  ```bash
  python3 1_3_load_region_llm_results.py \
    --market scope:global \
    --run_id 20251218T0000_global_v2 \
    --input results_global_v2.jsonl
  
  python3 1_4_apply_region_llm_results.py \
    --market scope:global \
    --run_id 20251218T0000_global_v2
  ```

## トラブルシューティング

### OpenAI API エラー

```bash
# API キーが設定されているか確認
echo $OPENAI_API_KEY

# API キーを再設定
export OPENAI_API_KEY="sk-..."
```

### BigQuery への認証エラー

```bash
# GCP 認証を再実行
gcloud auth application-default login
gcloud config set project food-scroll
```

### results.jsonl が見つからない

```bash
# Batch API の結果をダウンロード
curl https://api.openai.com/v1/files/<OUTPUT_FILE_ID>/content \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -o /tmp/wikidata_food_region/results_global.jsonl
```

## ファイル構成

```
scripts/20251213T0000_wikidata_food_graph/557_region_gate/
├── 1_1_export_region_label_targets.py       # ステップ1: ターゲットエクスポート
├── 1_2_prepare_region_batch_payload.py      # ステップ2: ペイロード生成
├── 1_3_load_region_llm_results.py           # ステップ4: BigQuery ロード
├── 1_4_apply_region_llm_results.py          # ステップ5: features catalog 更新
├── llm_examples_region_global.json          # 教師データ（scope:global）
├── llm_examples_region_country_jp.json      # 教師データ（country:JP）
└── README.md                                # このファイル
```

## 関連ドキュメント

- [infra/big-query/README.md](../../../infra/big-query/README.md): BigQuery インフラストラクチャ全体の説明
- [infra/big-query/migration/20251213T0000_create_wikidata_food_tables.sql](../../../infra/big-query/migration/20251213T0000_create_wikidata_food_tables.sql): テーブル定義 SQL
- [scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/README.md](../548_wikidata_food_llm_labeling/README.md): 食品ノードへの LLM ラベリング基盤

## 関連チケット

- #557: region ホワイトリスト一括付与（LLM バッチ）
- #548: Wikidata 食品ノードへの LLM ラベリング基盤追加（dish_blacklist 強化）
- #550: macro_genre（Wikidata）ホワイトリスト運用＋割当結果テーブル作成（BigQuery）
- #533: Wikidata 由来の料理・飲み物グラフ構造テーブル作成（BigQuery）
