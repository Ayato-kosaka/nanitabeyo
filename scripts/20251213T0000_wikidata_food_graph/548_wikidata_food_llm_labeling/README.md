# Wikidata 食品ノードへの LLM ラベリング基盤

## 概要

このディレクトリには、Wikidata から取得した料理・飲み物ノードに対して LLM（gpt-4o-mini）を使ってラベリングを行い、`dish_blacklist` を強化するスクリプトが含まれています。

チケット: #548

## 目的

現状の `dish_blacklist` は ancestor ベースのブラックリストと SQL パターンマッチングで一定のノイズ除去ができているが、

- 「韓国料理」「ラーメン」など **抽象度は高いが "何食べよ？" の会話に自然に出るカテゴリ** は残したい
- 一方で、まだ **抽象クラス / 産業分類 / 菓子ブランド / チェーン SKU** などのノイズも残っている

という状態。

完全に SQL ロジックだけで精選するのは難易度が高いため、

- LLM による **ノード単位のラベリング** を導入し、
- **「残したいメニュー」 vs 「メニューとして出したくないもの」** を機械的に分離する

基盤を追加する。

## 前提条件

### BigQuery Dataset & Tables

以下の Dataset とテーブルが作成済みであること：

```bash
# Dataset 作成（既に存在する場合は不要）
cd ../../infra/big-query
./20251213T0000_setup_wikidata_food_graph_dataset.sh

# テーブル作成（20251213 スクリプトで作成済み）
cd ../../scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling
python3 1_1_create_tables.py

# LLM ラベリング用テーブル作成
# このディレクトリにはテーブル作成スクリプトは含まれません
# migration SQL を直接実行する必要があります
```

これにより以下のテーブルが利用可能になります：

- `food-scroll.wikidata_food_graph.food_nodes_raw`
- `food-scroll.wikidata_food_graph.dish_blacklist`
- `food-scroll.wikidata_food_graph.wikidata_food_llm_labels` (新規)

### Python 環境

Python 3.8 以上が必要です：

```bash
python3 --version
```

### 依存パッケージのインストール

```bash
pip install -r requirements.txt
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

## LLM ラベル定義

LLM が付与するラベルは以下の 5 種類：

### keep

**「なに食べよ？」の候補として残したい**

- 具体的な料理・飲み物名
  - 例：`galbi-tang`, `Sicilian pizza`, `Spaghett`（ビアカクテル）, `Bubur ketan hitam`
- 会話に自然に出る料理カテゴリー
  - 例：`salad`, `stew`, `bread`, `sandwich`, `cake`, `tea`, `cocktail`
- ご当地ラーメン・郷土料理など、**メニューとして自然**なもの

### too_generic

食品関連だが **抽象的なクラス / カテゴリ** に過ぎず、単体で「今日はこれ食べよう」とはなりにくいもの

- 例：
  - `food`, `human food`, `dish`, `sweet dish`, `meat dish`, `seafood dish`
  - `rice dish`, `noodle`, `noodle dish`, `poultry dish`, `pork dish`, `beef dish`
  - `plant-based food`, `cereal product`, `flour-based food`
  - `alcopop`, `malt beverage`, `non-alcoholic beverage`, `sugary drink`
  - `food ingredient`

### non_menu_item

**そもそも食べ物・飲み物というより概念 / 産業分類 / メタ情報** として扱うべきもの

- 抽象概念系：
  - `class`, `notion`, `umbrella term`, `skill`, `commodity`, `industry`
- メタ情報：
  - `product`, `type of manufactured good`, `version`
  - `Wikimedia list article`
  - `food products by OKPD2 (10)`, `Production of food industry by OKP`
- 地域のワイン産業など：
  - `viticulture of Aguascalientes`
- 完全にゲーム内レシピなど：
  - `Papa Louie special recipe`

### not_for_menu

食べ物・飲み物ではあるが、**アプリのメニュー選択肢としては出したくない**もの

- 菓子・キャンディ・ガム・そのブランド：
  - `candy`, `Wax lips`, `Oreo sandwich cookie`, `Opatów krówki`
  - `functional chewing gum`
- パッケージ菓子 / インスタント食品：
  - `Nissin Yakisoba UFO`, `Deutsches Reichsbräu`, `Cola up`
- スーパー / マスブランド：
  - `Kola Román`, `Sun Drop`, `Sam's Choice`
- 強めのアルコールブランドとしてのエントリ：
  - `Heaven Hill Kentucky Whiskey`, `Biancosarti`
- その他「スーパーマーケットの棚に並ぶ SKU」に近いもの

### uncertain

情報不足や曖昧さがあり、**自信を持って判定できない場合**

- 例：`Julienne`（文脈により「刻み方」「スープ」など意味が揺れる）

## 使用方法

スクリプトは4つのステップに分かれています。順番に実行してください。

### ステップ 1: dish_blacklist 未該当ノードをエクスポート

BigQuery から dish_blacklist に含まれていないノードを取得し、JSONL でエクスポートします。

```bash
python3 1_1_export_unlabeled_nodes.py
```

**出力:**

- `/tmp/wikidata_food_llm/items.jsonl`

**処理内容:**

- `food_nodes_raw` から `dish_blacklist` に含まれていないノードを取得
- `label_en IS NOT NULL` のノードのみを対象
- 1行1アイテムの JSONL 形式で出力

### ステップ 2: Batch API 用のペイロードを生成

items.jsonl を読み込み、OpenAI Batch API 用のペイロードを生成します。

```bash
python3 1_2_prepare_batch_payload.py
```

**出力:**

- `/tmp/wikidata_food_llm/batch_payload.jsonl`

**処理内容:**

- 20件ずつバッチにまとめる
- 教師データ（`llm_examples.json`）を含む system プロンプトを生成
- Batch API 用の JSONL を生成（1行1リクエスト）

### ステップ 3: OpenAI Batch API でラベリング実行

生成した `batch_payload.jsonl` を OpenAI Batch API にアップロードし、ラベリングを実行します。

```bash
# OpenAI CLI を使用する場合
# 1. バッチファイルをアップロード
openai api files.create -f /tmp/wikidata_food_llm/batch_payload.jsonl -p batch

# 2. バッチを作成
curl https://api.openai.com/v1/batches \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input_file_id": "file-xxx",
    "endpoint": "/v1/chat/completions",
    "completion_window": "24h",
    "metadata": {
      "task": "#548_menu_blacklist_classification",
      "run_id": "20251215T0000_v1"
    }
  }'


# 3. バッチの状態を確認
curl https://api.openai.com/v1/batches/<BATCH_ID> \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json"

# 4. 完了後、結果をダウンロード
# 成功結果
curl https://api.openai.com/v1/files/<OUTPUT_FILE_ID>/content \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -o /tmp/wikidata_food_llm/results.jsonl

# 失敗結果（あれば）
curl https://api.openai.com/v1/files/<ERROR_FILE_ID>/content \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -o /tmp/wikidata_food_llm/errors.jsonl
```

**注意:**

- Batch API の実行には時間がかかります（通常24時間以内）
- 詳細は [OpenAI Batch API ドキュメント](https://platform.openai.com/docs/guides/batch) を参照

### ステップ 4: LLM 結果を BigQuery にロード

Batch API の結果を BigQuery にロードします。

```bash
python3 1_3_load_llm_results.py --run-id 20251215T0000_v1
```

**入力:**

- `/tmp/wikidata_food_llm/results.jsonl`

**処理内容:**

- Batch API のレスポンスをパース
- ラベル統計を表示
- `wikidata_food_llm_labels` テーブルにロード

**注意:**

- `--run-id` は実行を識別するための ID です
- 同じ run_id で複数回実行すると重複データが登録されます

### ステップ 5: LLM ラベルに基づき dish_blacklist を更新

confidence='high' かつ除外対象ラベルを持つノードを dish_blacklist に反映します。

```bash
# dry-run モード（実際には反映しない）
python3 1_4_apply_llm_labels.py --run-id 20251215T0000_v1 --dry-run

# 実際に反映
python3 1_4_apply_llm_labels.py --run-id 20251215T0000_v1
```

**処理内容:**

- `wikidata_food_llm_labels` から統計情報を取得
- `confidence='high'` かつ `label IN ('too_generic', 'non_menu_item', 'not_for_menu')` を
  `dish_blacklist` に反映（`reason='llm_label'`）

## 処理フロー

```
ステップ 1: dish_blacklist 未該当ノードをエクスポート
↓
BigQuery から取得
↓
/tmp/wikidata_food_llm/items.jsonl に保存

ステップ 2: Batch API 用のペイロードを生成
↓
20件ずつバッチに分割
↓
教師データを含む system プロンプトを生成
↓
/tmp/wikidata_food_llm/batch_payload.jsonl に保存

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

ステップ 5: dish_blacklist を更新
↓
confidence='high' の除外対象ラベルを抽出
↓
dish_blacklist に反映（reason='llm_label'）
```

## コスト見積もり

gpt-4o-mini + Batch API を利用することで、コストを大幅に削減できます。

### 見積もり条件

- 対象ノード数: 約 18,000 件
- バッチサイズ: 20件 / リクエスト
- リクエスト数: 約 900 件
- 平均トークン数（入力）: 約 2,500 トークン / リクエスト
- 平均トークン数（出力）: 約 500 トークン / リクエスト

### 料金（2024年12月時点）

- gpt-4.1-mini Batch API:
  - 入力: $0.20 / 1M トークン（通常の50%割引）
  - 出力: $0.80 / 1M トークン（通常の50%割引）

### 計算

- キャッシュインプット: 1,500 × 900 = 1.35M → $0.27
- 入力トークン: 700 × 900 = 0.63M → $0.326
- 出力トークン: 1,000 × 900 = 0.9M → $0.72
- **合計: 約 $1.316**

## 注意事項

### 初回実行時の確認事項

1. **必ず dry-run で確認する**

   ```bash
   python3 1_4_apply_llm_labels.py --run-id 20251215T0000_v1 --dry-run
   ```

2. **サンプリングして目視確認する**

   ```sql
   SELECT *
   FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
   WHERE run_id = '20251215T0000_v1'
     AND label = 'too_generic'
     AND confidence = 'high'
   LIMIT 100;
   ```

3. **明らかに間違っているケースがあれば**
   - `llm_examples.json` に例を追加
   - system プロンプト（`llm_client.py`）を微調整
   - 新しい run_id で再実行

### ラベルの扱い

- `keep` → dish_blacklist には何もしない（残す）
- `too_generic` / `non_menu_item` / `not_for_menu` → 条件付きで dish_blacklist に反映
- `uncertain` → 自動反映しない（別途レビュー対象）

### confidence の扱い

- `high` → 自動で dish_blacklist に反映
- `medium` / `low` → 自動反映しない（必要に応じて人手でレビュー）

### 複数回実行する場合

- 同じ run_id で複数回実行すると重複データが登録されます
- プロンプトを微調整して再実行する場合は、必ず新しい run_id を使用してください

  ```bash
  python3 1_3_load_llm_results.py --run-id 20251215T0000_v2
  python3 1_4_apply_llm_labels.py --run-id 20251215T0000_v2
  ```

## 作成される BigQuery テーブル

### wikidata_food_llm_labels

LLM ラベリング結果を保持するテーブル。

**カラム:**

- `item_qid`: Wikidata QID
- `task`: タスク識別子（例: '#548_menu_blacklist_classification'）
- `label`: ラベル（'keep' / 'too_generic' / 'non_menu_item' / 'not_for_menu' / 'uncertain'）
- `confidence`: 信頼度（'high' / 'medium' / 'low'）
- `reason`: LLM の説明（英語）
- `model`: モデル名（'gpt-4.1-mini'）
- `run_id`: バッチ実行ごとの識別子
- `created_at`: 登録日時

## BigQuery での確認方法

### ラベリング結果の確認

```sql
-- ラベルごとの件数
SELECT
  label,
  confidence,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE run_id = '20251215T0000_v1'
GROUP BY label, confidence
ORDER BY label, confidence;

-- サンプル確認
SELECT *
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE run_id = '20251215T0000_v1'
  AND label = 'too_generic'
  AND confidence = 'high'
LIMIT 10;
```

### dish_blacklist への反映確認

```sql
-- llm_label で追加された件数
SELECT COUNT(*)
FROM `food-scroll.wikidata_food_graph.dish_blacklist`
WHERE reason = 'llm_label';

-- サンプル確認
SELECT
  db.dish_qid,
  db.note AS label,
  fnr.label_en,
  fnr.desc_en
FROM `food-scroll.wikidata_food_graph.dish_blacklist` AS db
JOIN `food-scroll.wikidata_food_graph.food_nodes_raw` AS fnr
  ON db.dish_qid = fnr.item_qid
WHERE db.reason = 'llm_label'
LIMIT 10;
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
openai api files.content --file-id file-yyy > /tmp/wikidata_food_llm/results.jsonl
```

### テーブルが作成されない

```bash
# migration を手動で実行
cd ../../infra/big-query/migration
bq query --use_legacy_sql=false < 20251215T0000_create_wikidata_food_llm_labels.sql
```

## ファイル構成

```
scripts/20251215T0000_wikidata_food_llm_labeling/
├── __init__.py
├── 1_1_export_unlabeled_nodes.py       # ステップ1: ノードエクスポート
├── 1_2_prepare_batch_payload.py        # ステップ2: ペイロード生成
├── 1_3_load_llm_results.py             # ステップ4: BigQuery ロード
├── 1_4_apply_llm_labels.py             # ステップ5: dish_blacklist 更新
├── llm_client.py                       # LLM クライアント（プロンプト管理）
├── loader_bigquery.py                  # BigQuery ロード処理
├── llm_examples.json                   # 教師データ（約65件）
├── requirements.txt                    # Python 依存パッケージ
└── README.md                           # このファイル
```

## 関連ドキュメント

- [infra/big-query/README.md](../../infra/big-query/README.md): BigQuery インフラストラクチャ全体の説明
- [infra/big-query/migration/20251215T0000_create_wikidata_food_llm_labels.sql](../../infra/big-query/migration/20251215T0000_create_wikidata_food_llm_labels.sql): テーブル定義 SQL
- [scripts/20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/README.md](../20251213T0000_wikidata_food_graph/548_wikidata_food_llm_labeling/README.md): 食品グラフ抽出スクリプトの説明

## 関連チケット

- #548: Wikidata 食品ノードへの LLM ラベリング基盤追加（dish_blacklist 強化）
- #533: Wikidata 由来の料理・飲み物グラフ構造テーブル作成（BigQuery）
