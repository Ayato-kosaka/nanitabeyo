# #575 dine_out_orderability × region:country:JP LLMバッチラベリング

## 概要

このディレクトリには、dish_category_catalog に対して **dine_out_orderability（外食目的適性）** を LLM で付与するスクリプトが含まれています。

チケット: #575

## 目的

- dish_category_catalog（**gate: region:country:JP で allow 済み**）に対し、**dine_out_orderability（外食目的適性）** を LLM で付与する
- dine_out_orderability は **market_salience（想起の強さ）とは独立**した feature とし、「それを食べに店へ行く」対象として成立しないカテゴリを自然に沈めるために使う
- 小売・家庭消費が主戦場のカテゴリ（例：食パン、缶コーヒー等）を **gate では落とさず、最終スコアで弱く抑制**することを目的とする
- **Batch API** 前提でコストを抑え、run_id 管理・再実行・比較が可能な運用とする

## アーキテクチャ

### スコア定義

dine_out_orderability は **離散値 0 / 0.5 / 1 のみ**：

| score | 定義                                                            |
| ----- | --------------------------------------------------------------- |
| 1     | そのカテゴリ目的で店に行く。専門店・カテゴリ店が成立する        |
| 0.5   | 外食で提供されるが、「それ目的で行く」は弱い                    |
| 0     | 主戦場が小売・家庭。外食検索語として不適（ブランド/市販品含む） |

### 強制ルール

- **ブランド名 / 市販品 / RTD 商品 → 必ず score=0**
- 「家庭料理」「惣菜」「パン・菓子の素材名」なども原則 0 or 0.5

### feature 仕様

- `feature_type = 'dine_out_orderability'`
- `feature_key = 'global'`（付与は global のみ）
- `score = {0, 0.5, 1}`
- `source = 'llm'`
- `run_id`：publish run id
- `note`：モデル名・task・簡易分布などを JSON で格納可能

### スコア適用（下流ロジック前提）

```text
final_score *= (0.1 + 0.9 * dine_out_orderability_score)
```

完全除外を避けつつ、外食適性の低いカテゴリを十分に沈める設計。

## ディレクトリ構成

```
575_dine_out_orderability/
├── config.yml                   # 設定ファイル
├── README.md                    # このファイル
├── prompts/
│   └── jp_dine_out_orderability.py    # JP用 system/user prompt 組み立て関数
├── sql/
│   ├── export_input.sql         # input 抽出
│   └── publish_features.sql     # features投入（merge/upsert）
├── lib/
│   ├── bq.py                    # BigQuery 操作
│   ├── batch_api.py             # OpenAI Batch API 操作
│   ├── io.py                    # ファイル I/O
│   └── metrics.py               # Token集計・分布計算
├── 1_1_export_input.py          # 入力エクスポート
├── 1_2_build_payload.py         # ペイロード生成
├── 1_3_submit_batch.py          # バッチ投入
├── 1_3_poll_batch.py            # バッチポーリング＆結果ダウンロード
├── 1_4_load_results.py          # BigQuery ロード
└── 1_5_publish_features.py      # features 投入
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

### ステップ 1-1: 入力データエクスポート

BigQuery から JP gate allow のアイテムを抽出し、JSONL でエクスポートします。

```bash
cd 575_dine_out_orderability
python3 1_1_export_input.py
```

**出力:**

- `/tmp/wikidata_food_dine_out_orderability/input.jsonl`

### ステップ 1-2: Batch API ペイロード生成

```bash
python3 1_2_build_payload.py
```

**出力:**

- `/tmp/wikidata_food_dine_out_orderability/payload/batch_payload.jsonl`

### ステップ 1-3: バッチ投入とポーリング

```bash
# バッチ投入
python3 1_3_submit_batch.py

# バッチ完了まで待機（別ターミナルで実行可）
python3 1_3_poll_batch.py
```

**出力:**

- `/tmp/wikidata_food_dine_out_orderability/results/batch_id.txt`
- `/tmp/wikidata_food_dine_out_orderability/results/results.jsonl`

### ステップ 1-4: BigQuery ロード

```bash
python3 1_4_load_results.py
```

**処理内容:**

- Batch API のレスポンスをパース
- `wikidata_food_llm_labels` テーブルにロード
- メトリクス集計・出力（`metrics.json`）

### ステップ 1-5: features 投入

```bash
# dry-run モード（プレビュー）
python3 1_5_publish_features.py --dry-run

# 実際に反映
python3 1_5_publish_features.py
```

**処理内容:**

- `dish_category_features_catalog` に MERGE 反映

## config.yml 設定項目

主要な設定項目：

- `dataset`: BigQuery データセット（`food-scroll.wikidata_food_graph`）
- `task`: タスク識別子（`#575_dine_out_orderability`）
- `run_id_prefix`: 実行ID接頭辞（例：`20251221T0000`）
- `model`: モデル名（`gpt-4.1-mini` または `gpt-5-mini`）
- `batch_api`: Batch API 使用フラグ（`true`）
- `batch_poll_interval_sec`: ポーリング間隔（`30`秒）
- `max_items`: テスト用データ制限（`null` = 全件処理）
- `batch_size`: 1リクエストあたりのアイテム数（`10`）

## 出力テーブル

### wikidata_food_llm_labels

LLM ラベリング結果を保持するテーブル。

**カラム:**

- `item_qid`: Wikidata QID
- `task`: タスク識別子（`#575_dine_out_orderability`）
- `label`: スコア文字列（`"0"`, `"0.5"`, `"1"`）
- `confidence`: 信頼度（`high` / `medium` / `low`）
- `reason`: 理由（`<= 120 chars`）
- `model`: モデル名（`gpt-4.1-mini` / `gpt-5-mini`）
- `run_id`: バッチ実行ごとの識別子
- `created_at`: 登録日時

### dish_category_features_catalog

dine_out_orderability feature を保持するテーブル。

**カラム:**

- `item_qid`: dish_category QID
- `feature_type`: `dine_out_orderability`
- `feature_key`: `global`
- `score`: スコア（0, 0.5, 1）
- `source`: `llm`
- `run_id`: publish run id（例：`20251221T0000_publish`）
- `updated_at`: 最終更新日時
- `note`: JSON（confidence, model, task）

## メトリクス出力

実行ごとに、以下のメトリクスが `/tmp/wikidata_food_dine_out_orderability/results/` に出力されます：

- `metrics.json`

**内容:**

- 件数（input_count, success_count, error_count）
- Token 統計（avg/p50/p95 input/output tokens）
- スコア分布（0, 0.5, 1 の件数）
- Confidence 分布（high, medium, low の件数）

## BigQuery での確認方法

### ラベリング結果の確認

```sql
-- 結果分布
SELECT
  CAST(label AS FLOAT64) AS score,
  confidence,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task = '#575_dine_out_orderability'
  AND run_id = '20251221T0000'
GROUP BY label, confidence
ORDER BY score, confidence;
```

### features への反映確認

```sql
-- dine_out_orderability feature の件数
SELECT
  feature_key,
  COUNT(*) as count,
  AVG(score) as avg_score
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
WHERE feature_type = 'dine_out_orderability'
  AND run_id = '20251221T0000_publish'
GROUP BY feature_key;

-- サンプル確認
SELECT
  fc.item_qid,
  cat.label_ja,
  fc.score,
  JSON_EXTRACT_SCALAR(fc.note, '$.confidence') AS confidence
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog` AS fc
JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` AS cat
  ON fc.item_qid = cat.item_qid
WHERE fc.feature_type = 'dine_out_orderability'
  AND fc.feature_key = 'global'
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
BATCH_ID=$(cat /tmp/wikidata_food_dine_out_orderability/results/batch_id.txt)
curl https://api.openai.com/v1/batches/$BATCH_ID \
  -H "Authorization: Bearer $OPENAI_API_KEY"
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
   WHERE task = '#575_dine_out_orderability'
     AND run_id = '20251221T0000'
     AND confidence = 'high'
   LIMIT 100;
   ```

3. **明らかに間違っているケースがあれば**
   - プロンプト（`prompts/jp_dine_out_orderability.py`）を微調整
   - 新しい run_id で再実行

### 複数回実行する場合

- 同じ run_id で複数回実行すると重複データが登録されます
- プロンプトを微調整して再実行する場合は、必ず新しい run_id を使用してください

  ```bash
  # config.yml で run_id_prefix を変更
  run_id_prefix: "20251222T0000"  # 新しいタイムスタンプ
  ```

## 関連ドキュメント

- [572_market_salience/README.md](../572_market_salience/README.md): market_salience LLM ラベリング（参考実装）
- [557_region_gate/README.md](../557_region_gate/README.md): region gate LLM ラベリング（参考実装）

## 関連チケット

- #575: dine_out_orderability LLMラベリング（Batch API / single-pass）
- #572: market_salience × gate:region スコア一括付与（LLMバッチ）
- #557: region ホワイトリスト一括付与（LLMバッチ）
