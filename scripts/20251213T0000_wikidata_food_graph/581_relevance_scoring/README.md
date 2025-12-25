# #581 dish_category relevance_scoring（rubric-based feature scoring / Batch API）

## 概要

このディレクトリには、dish_category_catalog に対して **relevance feature スコア**を LLM で付与するスクリプトが含まれています。

チケット: #581

## 目的

* dish_category（**gate whitelist 通過済み**）に対し、**「外食文脈での自然さ」**を軸にした複数の relevance feature を LLM で付与する
* 本スコアは **人気・想起・市場規模とは独立**した特徴量とし、下流ランキングにおいて「文脈的に不自然な組み合わせ」を**弱く・一貫して沈める**ことを目的とする
* すべて **0 / 0.5 / 1 の離散値**で付与し、重み付け・合成は downstream に委ねる
* **Batch API 前提**で run_id 管理・再実行・差分比較が可能な運用とする

## Feature 定義

### A) timeSlot（時間帯適性）

* morning / lunch / afternoon / dinner / late_night
* 外食における時間帯での自然さを評価

### B) scene（誰と食べるか）

* solo / date / friends / family / drinking
* 社会的シーンでの自然さを評価

### C) satiety（満腹感）

* hearty / normal / light
* 料理のボリューム感を評価

### D) taste（印象タグ）

* sweet / spicy / healthy / junk / alcohol
* 味覚・印象の特徴を評価（複数1可）

## スコア定義

すべての feature で共通：

| score | 定義                           |
| ----- | ---------------------------- |
| 1     | その文脈で自然・典型的                  |
| 0.5   | 可能だが典型的ではない（迷ったらこれ）          |
| 0     | その文脈で不自然・不適切                 |

## アーキテクチャ

### Phase 1: スコアリング

* 全 feature を rubric に基づいてスコアリング
* 出力は **1 feature = 1 row**
* 結果を `wikidata_food_llm_feature_scores` に投入

### Phase 2: レビュー

* Phase1 の結果をレビューし、`accept / edit / deny` を判定
* edit は **隣接スコア修正（0↔0.5↔1）のみ**
* deny は投入しない
* edit / accept 結果を **新 run_id** で再投入

### Phase 3: 公開

* Phase2 が存在する場合は Phase2 を優先
* なければ Phase1 を採用
* deny レコードは除外
* `dish_category_features_catalog` に MERGE 反映

## ディレクトリ構成

```
581_relevance_scoring/
├── config.yml                          # 設定ファイル
├── README.md                           # このファイル
├── prompts/
│   ├── jp_relevance_scoring_phase1.py  # Phase1 スコアリング用プロンプト
│   └── jp_relevance_scoring_phase2.py  # Phase2 レビュー用プロンプト
├── sql/
│   ├── export_input.sql                # 入力抽出
│   └── publish_features.sql            # features 投入（merge/upsert）
├── lib/
│   ├── bq.py                           # BigQuery 操作
│   ├── batch_api.py                    # OpenAI Batch API 操作
│   ├── io.py                           # ファイル I/O
│   └── metrics.py                      # メトリクス集計
├── 1_1_export_input.py                 # 入力エクスポート
├── 1_2_build_payload_phase1.py         # Phase1 ペイロード生成
├── 1_3_submit_batch_phase1.py          # Phase1 バッチ投入
├── 1_3_poll_batch_phase1.py            # Phase1 バッチポーリング
├── 1_4_load_results_phase1.py          # Phase1 結果ロード
├── 2_1_build_payload_phase2.py         # Phase2 ペイロード生成
├── 2_2_submit_batch_phase2.py          # Phase2 バッチ投入
├── 2_2_poll_batch_phase2.py            # Phase2 バッチポーリング
├── 2_3_load_results_phase2.py          # Phase2 結果ロード
└── 3_1_publish_features.py             # features 投入
```

## 前提条件

### BigQuery Dataset & Tables

以下の Dataset とテーブルが作成済みであること：

- `food-scroll.wikidata_food_graph.dish_category_catalog`
- `food-scroll.wikidata_food_graph.dish_category_features_catalog`
- `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`

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

### Phase 1: スコアリング

#### ステップ 1-1: 入力データエクスポート

BigQuery から gate whitelist 通過済みのアイテムを抽出し、JSONL でエクスポートします。

```bash
cd 581_relevance_scoring
python3 1_1_export_input.py
```

**出力:**

- `/tmp/wikidata_food_relevance_scoring/input.jsonl`

#### ステップ 1-2: Phase1 ペイロード生成

```bash
python3 1_2_build_payload_phase1.py
```

**出力:**

- `/tmp/wikidata_food_relevance_scoring/payload/batch_payload_phase1.jsonl`

#### ステップ 1-3: Phase1 バッチ投入とポーリング

```bash
# バッチ投入
python3 1_3_submit_batch_phase1.py

# バッチ完了まで待機（別ターミナルで実行可）
python3 1_3_poll_batch_phase1.py
```

**出力:**

- `/tmp/wikidata_food_relevance_scoring/results/batch_id_phase1.txt`
- `/tmp/wikidata_food_relevance_scoring/results/results_phase1.jsonl`

#### ステップ 1-4: Phase1 結果ロード

```bash
python3 1_4_load_results_phase1.py
```

**処理内容:**

- Batch API のレスポンスをパース
- `wikidata_food_llm_feature_scores` テーブルにロード
- メトリクス集計・出力（`metrics_phase1.json`）

### Phase 2: レビュー

#### ステップ 2-1: Phase2 ペイロード生成

Phase1 の結果を BigQuery から取得し、レビュー用ペイロードを生成します。

```bash
python3 2_1_build_payload_phase2.py
```

**出力:**

- `/tmp/wikidata_food_relevance_scoring/payload/batch_payload_phase2.jsonl`

#### ステップ 2-2: Phase2 バッチ投入とポーリング

```bash
# バッチ投入
python3 2_2_submit_batch_phase2.py

# バッチ完了まで待機
python3 2_2_poll_batch_phase2.py
```

**出力:**

- `/tmp/wikidata_food_relevance_scoring/results/batch_id_phase2.txt`
- `/tmp/wikidata_food_relevance_scoring/results/results_phase2.jsonl`

#### ステップ 2-3: Phase2 結果ロード

```bash
python3 2_3_load_results_phase2.py
```

**処理内容:**

- レビュー結果をパース（accept / edit / deny）
- edit と deny のみ `wikidata_food_llm_feature_scores` にロード
- accept は Phase1 スコアをそのまま使用（記録不要）
- メトリクス集計・出力（`metrics_phase2.json`）

### Phase 3: 公開

#### ステップ 3-1: features 投入

```bash
# dry-run モード（プレビュー）
python3 3_1_publish_features.py --dry-run

# 実際に反映
python3 3_1_publish_features.py
```

**処理内容:**

- Phase2 が存在する場合は Phase2 を優先
- なければ Phase1 を採用
- deny レコードは除外
- `dish_category_features_catalog` に MERGE 反映

## config.yml 設定項目

主要な設定項目：

- `dataset`: BigQuery データセット（`food-scroll.wikidata_food_graph`）
- `task`: タスク識別子（`#581_relevance_scoring`）
- `run_id_prefix`: 実行ID接頭辞（例：`20251223T0000`）
- `final_run_id`: 最終公開用ID（例：`20251223T0000_final`）
- `model`: モデル名（`gpt-4.1-mini` または `gpt-5-mini`）
- `batch_api`: Batch API 使用フラグ（`true`）
- `batch_poll_interval_sec`: ポーリング間隔（`30`秒）
- `max_items`: テスト用データ制限（`null` = 全件処理）
- `batch_size`: 1リクエストあたりのアイテム数（`10`）

## 出力テーブル

### wikidata_food_llm_feature_scores

LLM スコアリング結果を保持するテーブル。

**カラム:**

- `item_qid`: Wikidata QID
- `feature_type`: `timeSlot` / `scene` / `satiety` / `taste`
- `feature_key`: 各 feature の key
- `score`: スコア（0, 0.5, 1）
- `confidence`: 信頼度（`high` / `medium` / `low` / `deny`）
- `reason`: 理由（`<= 120 chars`）
- `phase`: `phase1` / `phase2`
- `task`: タスク識別子（`#581_relevance_scoring`）
- `model`: モデル名（`gpt-4.1-mini` / `gpt-5-mini`）
- `run_id`: バッチ実行ごとの識別子
- `created_at`: 登録日時

### dish_category_features_catalog

relevance feature を保持するテーブル。

**カラム:**

- `item_qid`: dish_category QID
- `feature_type`: `timeSlot` / `scene` / `satiety` / `taste`
- `feature_key`: 各 feature の key
- `score`: スコア（0, 0.5, 1）
- `source`: `llm`
- `run_id`: publish run id（例：`20251223T0000_final`）
- `updated_at`: 最終更新日時
- `note`: JSON（confidence, reason, model, phase）

## メトリクス出力

実行ごとに、以下のメトリクスが `/tmp/wikidata_food_relevance_scoring/results/` に出力されます：

- `metrics_phase1.json`
- `metrics_phase2.json`

**内容:**

- 件数（input_count, success_count, error_count）
- Feature type 分布
- Score 分布（0, 0.5, 1 の件数）
- Confidence 分布
- Review action 分布（accept, edit, deny）

## BigQuery での確認方法

### Phase1 結果の確認

```sql
-- 結果分布
SELECT
  feature_type,
  feature_key,
  score,
  confidence,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
WHERE task = '#581_relevance_scoring'
  AND run_id = '20251223T0000_phase1'
GROUP BY feature_type, feature_key, score, confidence
ORDER BY feature_type, feature_key, score;
```

### Phase2 レビュー結果の確認

```sql
-- レビュー結果（edit / deny のみ記録される）
SELECT
  feature_type,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_feature_scores`
WHERE task = '#581_relevance_scoring'
  AND run_id = '20251223T0000_phase2'
GROUP BY feature_type;
```

### 最終公開結果の確認

```sql
-- 公開された features の件数
SELECT
  feature_type,
  feature_key,
  COUNT(*) as count,
  AVG(score) as avg_score
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog`
WHERE feature_type IN ('timeSlot', 'scene', 'satiety', 'taste')
  AND run_id = '20251223T0000_final'
GROUP BY feature_type, feature_key
ORDER BY feature_type, feature_key;

-- サンプル確認
SELECT
  fc.item_qid,
  cat.label_ja,
  fc.feature_type,
  fc.feature_key,
  fc.score,
  JSON_EXTRACT_SCALAR(fc.note, '$.confidence') AS confidence,
  JSON_EXTRACT_SCALAR(fc.note, '$.phase') AS phase
FROM `food-scroll.wikidata_food_graph.dish_category_features_catalog` AS fc
JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` AS cat
  ON fc.item_qid = cat.item_qid
WHERE fc.feature_type IN ('timeSlot', 'scene', 'satiety', 'taste')
  AND fc.run_id = '20251223T0000_final'
LIMIT 50;
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
BATCH_ID=$(cat /tmp/wikidata_food_relevance_scoring/results/batch_id_phase1.txt)
curl https://api.openai.com/v1/batches/$BATCH_ID \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

## 注意事項

### 初回実行時の確認事項

1. **必ず dry-run で確認する**

   ```bash
   python3 3_1_publish_features.py --dry-run
   ```

2. **サンプリングして目視確認する**

   BigQuery で Phase1 結果をサンプリング確認

3. **明らかに間違っているケースがあれば**
   - プロンプト（`prompts/jp_relevance_scoring_phase1.py`）を微調整
   - 新しい run_id で再実行

### 複数回実行する場合

- 同じ run_id で複数回実行すると重複データが登録されます
- プロンプトを微調整して再実行する場合は、必ず新しい run_id を使用してください

  ```yaml
  # config.yml で run_id_prefix を変更
  run_id_prefix: "20251224T0000"  # 新しいタイムスタンプ
  ```

## 関連ドキュメント

- [575_dine_out_orderability/README.md](../575_dine_out_orderability/README.md): dine_out_orderability LLM ラベリング（参考実装）
- [572_market_salience/README.md](../572_market_salience/README.md): market_salience LLM ラベリング（参考実装）
- [557_region_gate/README.md](../557_region_gate/README.md): region gate LLM ラベリング（参考実装）

## 関連チケット

- #581: dish_category relevance_scoring（rubric-based feature scoring / Batch API）
- #575: dine_out_orderability LLMラベリング（Batch API / single-pass）
- #572: market_salience × gate:region スコア一括付与（LLMバッチ）
- #557: region ホワイトリスト一括付与（LLMバッチ）

## 設計の重要ポイント

### 評価視点（超重要・固定）

**本タスクにおける「自然さ」の定義：**

> 日本において
> **外食メニューとして一般的に成立するかどうか**

### 明示的に評価しないもの

* 年齢層・世代差
* 個人嗜好
* 健康・ダイエット観点
* 人気・定番度・文化的重要性

※ 迷った場合は **0.5 に倒す**

### Phase2 レビュールール

* rubric 適用チェック専用
* 新しい判断軸・例外ルールは作らない
* edit は隣接スコア修正（0↔0.5↔1）のみ
* 大きなジャンプ（0↔1）は deny 扱い
