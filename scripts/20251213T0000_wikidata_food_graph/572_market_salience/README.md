# #572 market_salience × region:country:JP LLMバッチラベリング

## 概要

このディレクトリには、dish_category_catalog に対して **market_salience（日本市場の定番度）** を LLM で付与するスクリプトが含まれています。

チケット: #572

## 目的

- dish_category_catalog（gate: region:country:JP で allow 済み想定）に対し、**market_salience（日本市場の定番度）** を LLM で付与する
- **Batch API** 前提でコストを抑えつつ、run_id 管理と rerun 比較ができる運用にする
- 2nd pass は **1st pass の confidence に応じて限定**し、精度/コストを最適化する
- 付随で **郷土料理フラグ（is_regional）** を同時に付与し、後段の制御・分析に使えるようにする

## アーキテクチャ

### スコア定義

market_salience は 0, 0.25, 0.5, 0.75, 1 の5段階で評価します：

- **score=1**: 定番・Very established（ラーメン, 寿司, カレー, ピザ, パスタ）
- **score=0.75**: 広く認知・Widely known（フォー, ビビンバ, タコス, パフェ）
- **score=0.5**: やや認知・Moderately known（もつ鍋, ケバブ, ガパオ）
- **score=0.25**: 限定的・Limited（ニッチ・ローカル）
- **score=0**: Not searchable（食材・調味料・抽象カテゴリ）

### is_regional フラグ

- **true**: 郷土料理（desc_ja に「◯◯県」「◯◯地方」「名物」「郷土」等の記載がある）
- **false**: 全国区または地域性なし

### 2-pass 方式

1. **Pass1**: 全対象アイテムを判定
2. **Pass2**: Pass1 で `confidence in ['medium', 'low']` だったアイテムを再判定（gpt-5.2 使用）

## ディレクトリ構成

```
572_market_salience/
├── config.yml                   # 設定ファイル
├── README.md                    # このファイル
├── prompts/
│   └── jp_market_salience.py    # JP用 system/user prompt 組み立て関数
├── sql/
│   ├── p1_export_input.sql      # Pass1 input 抽出
│   ├── p2_export_input.sql      # Pass2 input 抽出
│   ├── aggregate_expected_value.sql  # 期待値集計
│   └── publish_features.sql     # features投入（merge/upsert）
├── lib/
│   ├── bq.py                    # BigQuery 操作
│   ├── batch_api.py             # OpenAI Batch API 操作
│   ├── io.py                    # ファイル I/O
│   └── metrics.py               # Token集計・発火率計算
├── 1_1_export_input.py          # Pass1: 入力エクスポート
├── 1_2_build_payload.py         # Pass1: ペイロード生成
├── 1_3_submit_batch.py          # Pass1: バッチ投入
├── 1_3_poll_batch.py            # Pass1: バッチポーリング＆結果ダウンロード
├── 1_4_load_results.py          # Pass1: BigQuery ロード
├── 1_5_publish_features.py      # Pass1: features 投入
├── 2_1_export_input.py          # Pass2: 入力エクスポート
├── 2_2_build_payload.py         # Pass2: ペイロード生成
├── 2_3_submit_batch.py          # Pass2: バッチ投入
├── 2_3_poll_batch.py            # Pass2: バッチポーリング＆結果ダウンロード
├── 2_4_load_results.py          # Pass2: BigQuery ロード
└── 2_5_publish_features.py      # Pass2: features 投入
```

## 前提条件

### BigQuery Dataset & Tables

以下の Dataset とテーブルが作成済みであること：

- `food-scroll.wikidata_food_graph.dish_category_catalog`
- `food-scroll.wikidata_food_graph.dish_category_features_catalog`
- `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`

### Python 環境

Python 3.8 以上が必要です：

```bash
python3 --version
```

### 依存パッケージのインストール

```bash
cd scripts/20251213T0000_wikidata_food_graph
pip install -r requirements.txt
# または
pip install google-cloud-bigquery pyyaml requests
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

## 使用方法

### Pass1 実行（全アイテム）

#### ステップ 1-1: 入力データエクスポート

BigQuery から JP gate allow のアイテムを抽出し、JSONL でエクスポートします。

```bash
python3 1_1_export_input.py
```

**出力:**

- `/tmp/wikidata_food_market_salience/p1_input.jsonl`

#### ステップ 1-2: Batch API ペイロード生成

```bash
python3 1_2_build_payload.py
```

**出力:**

- `/tmp/wikidata_food_market_salience/payload/batch_payload_p1.jsonl`

#### ステップ 1-3: バッチ投入とポーリング

```bash
# バッチ投入
python3 1_3_submit_batch.py

# バッチ完了まで待機（別ターミナルで実行可）
python3 1_3_poll_batch.py
```

**出力:**

- `/tmp/wikidata_food_market_salience/results/p1_batch_id.txt`
- `/tmp/wikidata_food_market_salience/results/p1_results.jsonl`

#### ステップ 1-4: BigQuery ロード

```bash
python3 1_4_load_results.py
```

**処理内容:**

- Batch API のレスポンスをパース
- `wikidata_food_llm_labels` テーブルにロード
- メトリクス集計・出力（`p1_metrics.json`）

#### ステップ 1-5: features 投入（Pass2 完了後に実行推奨）

```bash
# dry-run モード（プレビュー）
python3 1_5_publish_features.py --dry-run

# 実際に反映
python3 1_5_publish_features.py
```

**処理内容:**

- Pass1 と Pass2 の結果を統合（Pass2 優先）
- 期待値（expected_score）を計算
- `dish_category_features_catalog` に MERGE 反映

### Pass2 実行（medium/low confidence のみ）

#### ステップ 2-1: 入力データエクスポート

Pass1 で `confidence in ['medium', 'low']` だったアイテムを再抽出します。

```bash
python3 2_1_export_input.py
```

**出力:**

- `/tmp/wikidata_food_market_salience/p2_input.jsonl`

#### ステップ 2-2〜2-5: Pass1 と同様の手順

```bash
python3 2_2_build_payload.py
python3 2_3_submit_batch.py
python3 2_3_poll_batch.py
python3 2_4_load_results.py
python3 2_5_publish_features.py
```

## config.yml 設定項目

主要な設定項目：

- `dataset`: BigQuery データセット（`food-scroll.wikidata_food_graph`）
- `market_key`: Market 識別子（`region:country:JP`）
- `run_id_prefix`: 実行ID接頭辞（例：`20251221T0000`）
- `model_pass1`: Pass1 モデル（`gpt-4.1-mini` または `gpt-5-mini`）
- `model_pass2`: Pass2 モデル（`gpt-5.2`）
- `batch_api`: Batch API 使用フラグ（`true`）
- `batch_poll_interval_sec`: ポーリング間隔（`30`秒）
- `max_items`: テスト用データ制限（`null` = 全件処理）
- `pass2_trigger_confidence`: Pass2 発火条件（`["medium", "low"]`）
- `batch_size`: 1リクエストあたりのアイテム数（`10`）

## 出力テーブル

### wikidata_food_llm_labels

LLM ラベリング結果を保持するテーブル。

**カラム:**

- `item_qid`: Wikidata QID
- `task`: タスク識別子（`#572_market_salience_p1` / `#572_market_salience_p2`）
- `label`: スコア文字列（`"0"`, `"0.25"`, `"0.5"`, `"0.75"`, `"1"`）
- `confidence`: 信頼度（`high` / `medium` / `low`）
- `reason`: 理由（`<= 120 chars`、is_regional 情報を含む）
- `model`: モデル名（`gpt-4.1-mini` / `gpt-5.2`）
- `run_id`: バッチ実行ごとの識別子
- `created_at`: 登録日時

### dish_category_features_catalog

market_salience feature を保持するテーブル。

**カラム:**

- `item_qid`: dish_category QID
- `feature_type`: `market_salience`
- `feature_key`: `region:country:JP`
- `score`: 期待値スコア（0〜1）
- `source`: `llm`
- `run_id`: publish run id（例：`20251221T0000_publish`）
- `updated_at`: 最終更新日時
- `note`: JSON（confidence, is_regional, model, task, source_pass）

## メトリクス出力

各実行ごとに、以下のメトリクスが `/tmp/wikidata_food_market_salience/results/` に出力されます：

- `p1_metrics.json` / `p2_metrics.json`

**内容:**

- 件数（input_count, success_count, error_count）
- Token 統計（avg/p50/p95 input/output tokens）
- Pass2 発火率（triggered_count / trigger_rate）
- スコア分布（0, 0.25, 0.5, 0.75, 1 の件数）
- Confidence 分布（high, medium, low の件数）
- is_regional 真率

## コスト見積もり

### 見積もり条件（1 pass あたり）

- 対象ノード数: 約 10,000 件（JP gate allow 想定）
- バッチサイズ: 10件 / リクエスト
- リクエスト数: 約 1,000 件
- 平均トークン数（入力）: 約 800 トークン / リクエスト
- 平均トークン数（出力）: 約 300 トークン / リクエスト

### 料金（2024年12月時点）

- gpt-4.1-mini Batch API:
  - 入力: $0.075 / 1M トークン（通常の50%割引）
  - 出力: $0.30 / 1M トークン（通常の50%割引）

### 計算

- 入力トークン: 800 × 1,000 = 0.8M → $0.06
- 出力トークン: 300 × 1,000 = 0.3M → $0.09
- **Pass1 合計: 約 $0.15**
- **Pass2 合計: 約 $0.05**（発火率30%想定）
- **総合計: 約 $0.20**

## BigQuery での確認方法

### ラベリング結果の確認

```sql
-- Pass1 結果
SELECT
  CAST(label AS FLOAT64) AS score,
  confidence,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task = '#572_market_salience_p1'
  AND run_id = '20251221T0000_p1'
GROUP BY label, confidence
ORDER BY score, confidence;

-- is_regional 真率
SELECT
  COUNTIF(LOWER(reason) LIKE '%regional%') AS regional_count,
  COUNT(*) AS total,
  COUNTIF(LOWER(reason) LIKE '%regional%') / COUNT(*) AS regional_rate
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task = '#572_market_salience_p1'
  AND run_id = '20251221T0000_p1';
```

### features への反映確認

```sql
-- market_salience feature の件数
SELECT
  feature_key,
  COUNT(*) as count,
  AVG(score) as avg_score
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
WHERE feature_type = 'market_salience'
  AND run_id = '20251221T0000_publish'
GROUP BY feature_key;

-- サンプル確認
SELECT
  fc.item_qid,
  cat.label_ja,
  fc.score,
  JSON_EXTRACT_SCALAR(fc.note, '$.confidence') AS confidence,
  JSON_EXTRACT_SCALAR(fc.note, '$.is_regional') AS is_regional
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog` AS fc
JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` AS cat
  ON fc.item_qid = cat.item_qid
WHERE fc.feature_type = 'market_salience'
  AND fc.feature_key = 'region:country:JP'
  AND fc.run_id = '20251221T0000_publish'
LIMIT 20;
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

### バッチが完了しない

```bash
# バッチステータスを手動確認
curl https://api.openai.com/v1/batches/<BATCH_ID> \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# または batch_id.txt から読み込んで確認
BATCH_ID=$(cat /tmp/wikidata_food_market_salience/results/p1_batch_id.txt)
curl https://api.openai.com/v1/batches/$BATCH_ID \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### ファイルが見つからない

```bash
# 出力ディレクトリを確認
ls -la /tmp/wikidata_food_market_salience/
ls -la /tmp/wikidata_food_market_salience/results/

# ステップをスキップしていないか確認
# 各ステップは前のステップの出力ファイルに依存
```

## 注意事項

### 初回実行時の確認事項

1. **必ず dry-run で確認する**

   ```bash
   python3 1_5_publish_features.py --dry-run
   ```

2. **サンプリングして目視確認する**

   ```sql
   SELECT *
   FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
   WHERE task = '#572_market_salience_p1'
     AND run_id = '20251221T0000_p1'
     AND confidence = 'high'
   LIMIT 100;
   ```

3. **明らかに間違っているケースがあれば**
   - プロンプト（`prompts/jp_market_salience.py`）を微調整
   - 新しい run_id で再実行

### 複数回実行する場合

- 同じ run_id で複数回実行すると重複データが登録されます
- プロンプトを微調整して再実行する場合は、必ず新しい run_id を使用してください

  ```bash
  # config.yml で run_id_prefix を変更
  run_id_prefix: "20251222T0000"  # 新しいタイムスタンプ
  ```

## 関連ドキュメント

- [infra/big-query/README.md](../../../infra/big-query/README.md): BigQuery インフラストラクチャ全体の説明
- [scripts/20251213T0000_wikidata_food_graph/557_region_gate/README.md](../557_region_gate/README.md): region gate LLM ラベリング（参考実装）
- [scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/README.md](../548_wikidata_food_llm_labeling/README.md): menu_blacklist LLM ラベリング

## 関連チケット

- #572: market_salience × gate:region スコア一括付与（LLMバッチ）
- #557: region ホワイトリスト一括付与（LLMバッチ）
- #548: Wikidata 食品ノードへの LLM ラベリング基盤追加
