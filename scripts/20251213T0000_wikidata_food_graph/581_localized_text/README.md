# #581 dish_category_localized_text LLM生成（Batch API / 2-pass / 採用版catalog洗い替え）

## 概要

このディレクトリには、**料理カテゴリ（Wikidata QID）ごとに感情訴求型の `topic_title` / `tagline` を多言語（ja-JP, en）で生成**するスクリプトが含まれています。

チケット: #581

## 目的

- ユーザーの「食べたい料理に気づく」体験を支えるため、料理カテゴリごとに感情訴求型コピーを生成
- 生成結果は **LLM実行ログとしてすべて保持**（`wikidata_food_copy_generations`）
- **アプリ・DBに投入するのは「採用版のみ」**（`dish_category_localized_text_catalog`）
- 再実行・比較・モデル変更・プロンプト調整を前提に、**run_id 管理 + Batch API + 2-pass** の運用基盤を整える

## アーキテクチャ

### テーブル責務

| レイヤ      | テーブル                               | 方針                         |
| ----------- | -------------------------------------- | ---------------------------- |
| LLM生成ログ | `wikidata_food_copy_generations`       | append-only / 全run保持      |
| 採用版      | `dish_category_localized_text_catalog` | **常に採用版のみ・ユニーク** |

- **confidence は catalog に持たない** - 採用条件は投入時のフィルタで完結
- catalog は「どれが採用されたか」の **結果テーブル**

### 出力仕様

各料理 × locale に対して以下を生成：

1. **topic_title**: 「形容詞 + 料理名」形式（最大12〜14文字）
   - 例（ja-JP）: 「炭火香る焼き鳥」「とろける生チョコ」
   - 例（en）: "Smoky Yakitori", "Silky Tiramisu"

2. **tagline**: 1文のみのキャッチコピー（最大45文字）
   - 例（ja-JP）: 「噛むほどに旨味が広がり、心まで満たされる。」
   - 例（en）: "Comfort in every bite."

### 2-pass 方式

1. **Pass1**: 全対象アイテム × locale を判定（gpt-4.1-mini）
2. **Pass2**: Pass1 で `confidence in ['medium', 'low']` だったものを再判定（gpt-4.1）
3. **Publish**: Pass2 優先で confidence='high' のみを catalog に投入

## ディレクトリ構成

```
581_localized_text/
├── config.yml                    # 設定ファイル
├── README.md                     # このファイル
├── prompts/
│   ├── localized_text_ja.py      # 日本語プロンプト
│   └── localized_text_en.py      # 英語プロンプト
├── sql/
│   ├── p1_export_input.sql       # Pass1 input 抽出
│   ├── p2_export_input.sql       # Pass2 input 抽出
│   └── publish_catalog.sql       # catalog 投入（MERGE）
├── lib/
│   ├── bq.py                     # BigQuery 操作
│   ├── batch_api.py              # OpenAI Batch API 操作
│   ├── io.py                     # ファイル I/O
│   └── metrics.py                # メトリクス計算
├── 1_1_export_input.py           # Pass1: 入力エクスポート
├── 1_2_build_payload.py          # Pass1: ペイロード生成
├── 1_3_submit_batch.py           # Pass1: バッチ投入
├── 1_4_poll_batch.py             # Pass1: バッチポーリング＆結果ダウンロード
├── 1_5_load_results.py           # Pass1: BigQuery ロード
├── 1_6_publish_catalog.py        # Pass1: catalog 投入
├── 2_1_export_input.py           # Pass2: 入力エクスポート
├── 2_2_build_payload.py          # Pass2: ペイロード生成
├── 2_3_submit_batch.py           # Pass2: バッチ投入
├── 2_4_poll_batch.py             # Pass2: バッチポーリング＆結果ダウンロード
├── 2_5_load_results.py           # Pass2: BigQuery ロード
└── 2_6_publish_catalog.py        # Pass2: catalog 投入（Pass2優先統合）
```

## 前提条件

### BigQuery Dataset & Tables

以下のテーブルが作成済みであること：

- `food-scroll.wikidata_food_graph.dish_category_catalog`
- `food-scroll.wikidata_food_graph.wikidata_food_copy_generations`
- `food-scroll.wikidata_food_graph.dish_category_localized_text_catalog`

### Python 環境

Python 3.8 以上が必要です。

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

### OpenAI API キー

```bash
export OPENAI_API_KEY="sk-..."
```

## 使用方法

### Pass1 実行（全アイテム）

#### ステップ 1-1: 入力データエクスポート

```bash
python3 1_1_export_input.py
```

**出力:** `/tmp/581/input/p1_input.jsonl`

#### ステップ 1-2: Batch API ペイロード生成

```bash
python3 1_2_build_payload.py
```

**出力:** `/tmp/581/payload/batch_payload_p1.jsonl`

#### ステップ 1-3: バッチ投入

```bash
python3 1_3_submit_batch.py
```

**出力:** `/tmp/581/results/p1_batch_id.txt`

#### ステップ 1-4: バッチ完了待機＆結果ダウンロード

```bash
python3 1_4_poll_batch.py
```

**出力:** `/tmp/581/results/p1_results.jsonl`

#### ステップ 1-5: BigQuery ロード

```bash
python3 1_5_load_results.py
```

**処理内容:**

- Batch API のレスポンスをパース
- `wikidata_food_copy_generations` テーブルにロード
- メトリクス集計・出力（`p1_metrics.json`）

#### ステップ 1-6: catalog 投入

```bash
python3 1_6_publish_catalog.py
```

**処理内容:**

- Pass1 結果から confidence='high' のみを抽出
- `dish_category_localized_text_catalog` に MERGE 反映

### Pass2 実行（medium/low confidence のみ）

#### ステップ 2-1〜2-6: Pass1 と同様の手順

```bash
python3 2_1_export_input.py
python3 2_2_build_payload.py
python3 2_3_submit_batch.py
python3 2_4_poll_batch.py
python3 2_5_load_results.py
python3 2_6_publish_catalog.py  # Pass2 優先で統合
```

## config.yml 設定項目

主要な設定項目：

- `dataset`: BigQuery データセット（`food-scroll.wikidata_food_graph`）
- `locales`: 対象locale（`["ja-JP", "en"]`）
- `run_id_prefix`: 実行ID接頭辞（例：`20251221T0000`）
- `model_pass1`: Pass1 モデル（`gpt-4.1-mini`）
- `model_pass2`: Pass2 モデル（`gpt-4.1`）
- `batch_api`: Batch API 使用フラグ（`true`）
- `batch_poll_interval_sec`: ポーリング間隔（`30`秒）
- `max_items`: テスト用データ制限（`null` = 全件処理）
- `pass2_trigger_confidence`: Pass2 発火条件（`["medium", "low"]`）
- `adopt_confidence`: catalog 採用条件（`["high"]`）
- `batch_size`: 1リクエストあたりのアイテム数（`10`）

## 出力テーブル

### wikidata_food_copy_generations

LLM 生成結果を append-only で保持するテーブル。

**カラム:**

- `item_qid`: Wikidata QID
- `locale`: BCP47 形式（`ja-JP`, `en`）
- `topic_title`: 感情訴求型タイトル
- `tagline`: キャッチコピー
- `confidence`: 信頼度（`high` / `medium` / `low`）
- `model`: モデル名（`gpt-4.1-mini` / `gpt-4.1`）
- `run_id`: バッチ実行ごとの識別子
- `created_at`: 登録日時
- `note`: 任意メモ（pass 情報など）

### dish_category_localized_text_catalog

採用版のみを保持するカタログテーブル。

**カラム:**

- `item_qid`: dish_category QID
- `locale`: BCP47 形式
- `topic_title`: 感情訴求型タイトル
- `tagline`: キャッチコピー
- `source`: `llm` / `manual`
- `selected_run_id`: 採用した run_id
- `updated_at`: 最終更新日時
- `note`: 任意メモ（model / pass 情報など）

## メトリクス出力

各実行ごとに、以下のメトリクスが `/tmp/581/results/` に出力されます：

- `p1_metrics.json` / `p2_metrics.json`

**内容:**

- 件数（input_count, success_count, error_count）
- Pass2 発火率（triggered_count / trigger_rate）
- Confidence 分布（high, medium, low の件数）
- Locale 分布（ja-JP, en の件数）

## BigQuery での確認方法

### 生成結果の確認

```sql
-- Pass1 結果
SELECT
  locale,
  confidence,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_copy_generations`
WHERE run_id = '20251221T0000_p1'
GROUP BY locale, confidence
ORDER BY locale, confidence;

-- サンプル確認
SELECT
  item_qid,
  locale,
  topic_title,
  tagline,
  confidence
FROM `food-scroll.wikidata_food_graph.wikidata_food_copy_generations`
WHERE run_id = '20251221T0000_p1'
  AND confidence = 'high'
LIMIT 20;
```

### catalog への反映確認

```sql
-- catalog 件数
SELECT
  locale,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.dish_category_localized_text_catalog`
GROUP BY locale;

-- サンプル確認
SELECT
  c.item_qid,
  cat.label_ja,
  cat.label_en,
  c.locale,
  c.topic_title,
  c.tagline
FROM `food-scroll.wikidata_food_graph.dish_category_localized_text_catalog` AS c
JOIN `food-scroll.wikidata_food_graph.dish_category_catalog` AS cat
  ON c.item_qid = cat.item_qid
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
BATCH_ID=$(cat /tmp/581/results/p1_batch_id.txt)
curl https://api.openai.com/v1/batches/$BATCH_ID \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

## 注意事項

### 初回実行時の確認事項

1. **必ずテストデータで確認する**

   ```yaml
   # config.yml
   max_items: 100 # テスト時は小さな値を指定
   ```

2. **サンプリングして目視確認する**

   ```sql
   SELECT *
   FROM `food-scroll.wikidata_food_graph.wikidata_food_copy_generations`
   WHERE run_id = '20251221T0000_p1'
     AND confidence = 'high'
   LIMIT 100;
   ```

3. **明らかに間違っているケースがあれば**
   - プロンプト（`prompts/localized_text_ja.py` / `localized_text_en.py`）を微調整
   - 新しい run_id で再実行

### 複数回実行する場合

- 同じ run_id で複数回実行すると重複データが登録されます
- プロンプトを微調整して再実行する場合は、必ず新しい run_id を使用してください

  ```yaml
  # config.yml
  run_id_prefix: "20251222T0000" # 新しいタイムスタンプ
  ```

## 関連ドキュメント

- [infra/big-query/README.md](../../../infra/big-query/README.md): BigQuery インフラストラクチャ全体の説明
- [scripts/20251213T0000_wikidata_food_graph/572_market_salience/README.md](../572_market_salience/README.md): market_salience LLM ラベリング（参考実装）
- [scripts/20251213T0000_wikidata_food_graph/557_region_gate/README.md](../557_region_gate/README.md): region gate LLM ラベリング（参考実装）

## 関連チケット

- #581: dish_category_localized_text LLM生成（Batch API / 2-pass / 採用版catalog洗い替え）
- #572: market_salience × gate:region スコア一括付与（LLMバッチ）
- #557: region ホワイトリスト一括付与（LLMバッチ）
