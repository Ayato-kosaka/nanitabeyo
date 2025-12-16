# macro_genre LLM 分類（A/B/C）

## 概要

このディレクトリには、macro_genre の非NULL化のための LLM による A/B/C 分類スクリプトが含まれています。

チケット: #550

## 目的

dish に対して macro_genre を自動割当するため、LLM を用いて以下の3つに分類します：

- **A (blacklist)**: メニュー候補として不適（地理銘柄/産業分類/メタクラス/非食/ブランドSKU）
- **B (self macro)**: 食べ物だが一般化できない（固有名詞・郷土料理）
- **C (map_to_macro)**: 一般的な料理枠に正規化できる（ramen/curry/cookie/wine/salad など）

## 前提条件

### 共通インフラ（#548 と共有）

親ディレクトリに以下の共通モジュールが配置されています：

- `llm_client.py`: LLM プロンプト管理とリクエスト組み立て
- `loader_bigquery_llm.py`: BigQuery へのデータロード

### BigQuery テーブル

以下のテーブルが既に存在している必要があります：

- `food_nodes_raw`
- `dish_blacklist`
- `dish_category_catalog`
- `wikidata_food_llm_labels`（#548 と共有）

### Python 環境

親ディレクトリの requirements.txt をインストールしてください：

```bash
cd ..
pip install -r requirements.txt
```

## 使用方法

スクリプトは4つのステップに分かれています。順番に実行してください。

### ステップ 2-1: 対象ノードのエクスポート

dish_blacklist 未該当の全 dish（13,888 件想定）を抽出します。

```bash
python3 2_1_export_macro_genre_label_targets.py
```

**出力:**
- `/tmp/wikidata_food_llm_macro_genre/items.jsonl`

### ステップ 2-2: Batch API ペイロード生成

20件ずつバッチにまとめた OpenAI Batch API 用ペイロードを生成します。

```bash
python3 2_2_prepare_macro_genre_batch_payload.py
```

**出力:**
- `/tmp/wikidata_food_llm_macro_genre/batch_payload.jsonl`

### ステップ 2-3: Batch API 実行（手動）

**外部作業:**

1. `batch_payload.jsonl` を OpenAI Batch API にアップロード
2. バッチ処理完了を待つ
3. `results.jsonl` をダウンロード
4. `/tmp/wikidata_food_llm_macro_genre/results.jsonl` に配置

### ステップ 2-4: 結果の BigQuery ロード

Batch API の結果を BigQuery にロードします。

```bash
python3 2_3_load_macro_genre_llm_results.py --run-id 20251216T0000_v1
```

**処理内容:**
- `wikidata_food_llm_labels` テーブルに結果をロード
- `task='#550_macro_genre_abc_classification'` で識別
- `label` フィールドに A/B/C を格納
- `note` フィールドに macro_genre（C の場合）を格納

### ステップ 2-5: 結果の適用

LLM 分類結果を反映します。

```bash
# dry-run で確認
python3 2_4_apply_macro_genre_llm_results.py --run-id 20251216T0000_v1 --dry-run

# 実際に適用
python3 2_4_apply_macro_genre_llm_results.py --run-id 20251216T0000_v1
```

**処理内容:**

- **decision=A (high)**: `dish_blacklist` に追加
- **decision=B/C (high)**: 統計表示（将来的に macro_genre 反映予定）

## LLM 分類仕様

### 入力

最小限の情報のみを LLM に渡します（コスト最適化）：

- `item_qid`
- `label_en`
- `desc_en`（最大200文字）

### 出力フォーマット

```json
{
  "results": [
    {
      "item_qid": "Q12345",
      "decision": "A|B|C",
      "confidence": "high|medium|low",
      "macro_genre": "ramen",
      "reason": "short explanation"
    }
  ]
}
```

### decision の定義

#### A: blacklist

メニュー候補として不適：

- メタ・分類・概念: `class`, `type`, `category`, `umbrella term`
- 産業分類: OKPD/CPA codes
- 地理銘柄・産地呼称: `Piemonte`, `D.O.`, `AOC`, `viticulture`
- ブランドSKU: `Oreo`, チェーン商品

#### B: self macro

食べ物だが一般化できない：

- 説明が薄い
- 固有名詞・郷土料理で一般枠が不明確
- 一般化すると情報が失われすぎる

例: `Toast skagen`, `Laufabrauð`, `chipa`

#### C: map_to_macro

一般的な料理枠に正規化できる：

- 明確な食べ物/飲み物
- 一般化された料理枠に畳める
- `macro_genre` は短い一般名（lower_snake_case）
- 固有名詞・地名・ブランド名は含めない

例:
- `Caesar salad` → `salad`
- `Shoyu ramen` → `ramen`
- `Beerenauslese` → `sweet_wine`

### 教師データ

`llm_examples_macro_genre.json` に 40 件の例を用意：

- A: 地理銘柄、産業分類、メタクラス（10件）
- B: 固有・伝統料理（4件）
- C: 一般枠に正規化可能（26件）

## 運用フロー

### 初回実行

1. **対象ノードエクスポート**: `2_1_export_macro_genre_label_targets.py`
2. **ペイロード生成**: `2_2_prepare_macro_genre_batch_payload.py`
3. **Batch API 実行**（手動）
4. **結果ロード**: `2_3_load_macro_genre_llm_results.py`
5. **結果適用**: `2_4_apply_macro_genre_llm_results.py`
6. **macro_genre 再構築**: `cd .. && python3 1_3_build_dish_macro_genre_analysis.py`

### 結果の確認

```sql
-- 統計確認
SELECT 
  label AS decision,
  confidence,
  COUNT(*) as count
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task = '#550_macro_genre_abc_classification'
  AND run_id = '20251216T0000_v1'
GROUP BY label, confidence
ORDER BY label, confidence;

-- decision=C の macro_genre 確認
SELECT 
  item_qid,
  label AS decision,
  note AS macro_genre,
  reason
FROM `food-scroll.wikidata_food_graph.wikidata_food_llm_labels`
WHERE task = '#550_macro_genre_abc_classification'
  AND run_id = '20251216T0000_v1'
  AND label = 'C'
  AND confidence = 'high'
LIMIT 100;
```

## ファイル構成

```
550_macro_genre/
├── 2_1_export_macro_genre_label_targets.py  # ステップ2-1: 対象抽出
├── 2_2_prepare_macro_genre_batch_payload.py # ステップ2-2: ペイロード生成
├── 2_3_load_macro_genre_llm_results.py      # ステップ2-4: 結果ロード
├── 2_4_apply_macro_genre_llm_results.py     # ステップ2-5: 結果適用
├── llm_examples_macro_genre.json            # 教師データ（40件）
└── README_LLM_CLASSIFICATION.md             # このファイル

../  # 親ディレクトリ（共有モジュール）
├── llm_client.py                            # LLM クライアント（#548/#550 共有）
└── loader_bigquery_llm.py                   # BigQuery ローダー（#548/#550 共有）
```

## 注意事項

- スクリプトは親ディレクトリの共通モジュールを利用します（#548 と共有）
- `wikidata_food_llm_labels` テーブルは #548 と共有（task で識別）
- decision=B/C の macro_genre 反映は将来の拡張ポイント
- 初回は必ず dry-run で統計を確認してから適用すること

## 次のステップ

1. BigQuery でデータを確認する
2. decision=A の blacklist 追加を確認する
3. decision=C の macro_genre 提案を確認する
4. `macro_genre_whitelist` を更新する
5. `1_3_build_dish_macro_genre_analysis.py` を再実行する
6. NULL 率の改善を確認する

## 関連ドキュメント

- [親ディレクトリ README](../README.md): Wikidata 食品グラフ抽出スクリプト全体
- [#548 README](../548_wikidata_food_llm_labeling/README.md): menu blacklist LLM 分類
- [macro_genre README](./README.md): macro_genre ホワイトリスト運用

## 関連チケット

- #550: macro_genre 非NULL化のための LLM 分類（A/B/C）＋ macro_genre 寄せ自動化
- #548: Wikidata food LLM labeling（menu blacklist 分類）
