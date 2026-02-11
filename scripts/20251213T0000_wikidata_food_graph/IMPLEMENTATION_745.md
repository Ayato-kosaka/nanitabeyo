# Implementation #745: Wikidata Food Nodes 抽出ロジックの 2 段階化（P31 / P279 closure）

## 概要

Wikidata からの料理ノード抽出ロジックを、property path `(wdt:P31|wdt:P279)*` に依存しない 2 段階設計にリファクタした。

### 背景

従来の実装では、以下のような property path を使用していた：

```sparql
?item (wdt:P31|wdt:P279)* ?root .
```

この実装には以下の問題があった：

1. **WDQS への負荷が非常に大きい**
   - P31 と P279 を任意回数組み合わせた property path になっており、グラフ全体に対する探索コストが大きい
   - WDQS のクォータ / タイムアウトの影響を受けやすい

2. **HTTP 200 でも部分的な結果になっている疑い**
   - 代表的な料理 QID（ice cream, cake, wine 等）が `food_nodes_raw` に一度も出てこない事象が発生
   - 本来は root まで P31/P279 経路で繋がっているのに取得されない

3. **ページング戦略が完全性を保証できない**
   - property path の評価が WDQS 側で途中打ち切りになっている場合、候補集合自体が不完全になりうる

## 解決方針：2 段階設計

### Stage 1: クラス閉包（P279*）の事前計算

各 root（dish/drink/dessert 等）について、P279* で到達可能な全クラスを事前に取得し、`food_class_closure` テーブルに保存する。

**利点：**
- クラス階層のみを扱うため、インスタンス数よりも遥かに少ない（数百〜数千程度）
- 一度計算すれば再利用可能
- 更新頻度が低い（root 変更 / Wikidata 構造変更時のみ）

**SPARQL クエリ例：**
```sparql
SELECT DISTINCT ?class
WHERE {
  ?class wdt:P279* wd:Q746549 .  # dish
  FILTER(STRSTARTS(STR(?class), "http://www.wikidata.org/entity/Q"))
}
```

### Stage 2: インスタンス取得（P31-only）

`food_class_closure` から取得したクラス QID のリストに対して、P31-only でインスタンスを取得する。

**利点：**
- property path を使用しないため、WDQS への負荷が大幅に削減
- 評価が単純なので、部分結果問題に巻き込まれにくい
- どのクラスからどのインスタンスが取得されているかデバッグしやすい

**SPARQL クエリ例：**
```sparql
SELECT DISTINCT ?item ?label_ja ?label_en ?desc_ja ?desc_en
WHERE {
  VALUES ?class { wd:Q13276 wd:Q13233 ... }  # food_class_closure から取得
  ?item wdt:P31 ?class .
  
  OPTIONAL { ?item rdfs:label ?label_ja FILTER(LANG(?label_ja) = "ja") }
  OPTIONAL { ?item rdfs:label ?label_en FILTER(LANG(?label_en) = "en") }
  OPTIONAL { ?item schema:description ?desc_ja FILTER(LANG(?desc_ja) = "ja") }
  OPTIONAL { ?item schema:description ?desc_en FILTER(LANG(?desc_en) = "en") }
  
  FILTER(STRSTARTS(STR(?item), "http://www.wikidata.org/entity/Q"))
}
ORDER BY ?item
LIMIT 1000
```

## 実装内容

### 1. BigQuery スキーマ変更

#### `food_class_closure` テーブル作成

```sql
CREATE TABLE IF NOT EXISTS `food_class_closure` (
  class_qid  STRING NOT NULL,   -- P279* で root に到達可能なクラス QID
  root_qid   STRING NOT NULL,   -- 元の root QID (food_roots.root_qid)
  kind       STRING NOT NULL,   -- root の kind (food_roots.kind より継承)
  depth      INT64  NOT NULL    -- root までの距離 (0=root 自身, 1=直接 subclass, ...)
);
```

### 2. 新規スクリプト：`1_1_5_fetch_and_load_classes.py`

クラス閉包を Wikidata から取得し、BigQuery にロードする。

**実行順序：**
```bash
# 1. テーブル作成（migration に food_class_closure を追加）
python3 1_1_create_tables.py

# 2. クラス閉包を取得（新規）
python3 1_1_5_fetch_and_load_classes.py

# 3. ノードを取得（1_1_5 の実行が前提となる）
python3 1_2_fetch_and_load_nodes.py

# 4. パスとサマリーを生成
python3 1_3_generate_paths_and_summary.py
```

**主要機能：**
- `food_roots` から root 定義を取得
- 各 root について `wikidata_client.fetch_class_closure()` を呼び出し
- 結果を `food_class_closure` にロード（Load Job / WRITE_TRUNCATE）
- 代表的なクラス（cake, ice cream, wine 等）が含まれているか検証

### 3. `wikidata_client.py` の変更

#### 新規メソッド：`fetch_class_closure()`

P279* でクラス閉包を取得する。

```python
def fetch_class_closure(
    self,
    root_qid: str,
    max_depth: Optional[int] = None,
) -> List[Dict]:
    """
    指定された root_qid に対して P279* でクラス閉包を取得
    
    Args:
        root_qid: ルート QID（例: 'Q746549'）
        max_depth: P279* の最大深度（None で無制限）
        
    Returns:
        [{'class_qid': 'Q12345', 'depth': 0}, ...]
    """
```

#### 既存メソッド変更：`fetch_food_nodes()`

**変更前：**
- 引数：`root_qids: List[str]`
- クエリ：`?item (wdt:P31|wdt:P279)* ?root`

**変更後：**
- 引数：`class_qids: List[str]`（food_class_closure から取得）
- クエリ：`?item wdt:P31 ?class`（P31-only）

**追加機能：WATCH_QIDS 監視**

代表的な QID のセット（ice cream, cake, wine 等）を定義し、取得されたタイミングをログ出力：

```python
WATCH_QIDS = {
    "Q13233",   # ice cream
    "Q13276",   # cake
    "Q282",     # wine
    # ... 他 11 QID
}
```

取得時に `🎯 WATCH_QID found: Q13233 (page 5)` のようにログが出る。

### 4. `loader_bigquery.py` の変更

#### 新規メソッド：`load_food_class_closure()`

クラス閉包を `food_class_closure` テーブルにロード（Load Job）。

#### 新規メソッド：`fetch_class_qids_from_closure()`

`food_class_closure` から全クラス QID を取得し、`fetch_food_nodes()` に渡す。

### 5. `1_2_fetch_and_load_nodes.py` の変更

**変更前：**
- `food_roots` から root ごとにノードを取得
- 各 root に対して `fetch_food_nodes([root_qid])` を呼び出し
- root 単位の一時ファイルに保存

**変更後：**
- `food_class_closure` から全クラス QID を取得（Phase 0.5）
- 全クラスに対してまとめて `fetch_food_nodes(class_qids)` を呼び出し（Phase 1）
- root 単位の一時ファイルは不要（互換性のため NODES_TEMP_DIR は残す）

**docstring 更新：**
- 事前に `1_1_5_fetch_and_load_classes.py` の実行が必要であることを明記
- 2 段階設計の説明を追加

### 6. `1_1_create_tables.py` の変更

migration リストに `20260211T0000_create_food_class_closure.sql` を追加。

## 検証ポイント

### 1. WATCH_QIDS の監視

以下の代表的な QID が全て取得されることを確認：

- Q13233: アイスクリーム (ice cream)
- Q13276: ケーキ (cake)
- Q282: ワイン (wine)
- Q13290: スムージー (smoothie)
- Q375: ワッフル (waffle)
- Q44541: パンケーキ (pancake)
- Q20129: オムレツ (omelette)
- Q58263: エッグベネディクト (eggs Benedict)
- Q6128: トースト (toast)
- Q6663: ハンバーガー (hamburger)
- Q8486: コーヒー (coffee)
- Q9266: サラダ (salad)
- Q41415: 汁物料理 (soup)
- Q6137769: チーズ盛り合わせ (cheese platter)

### 2. 整合性チェック

- `food_nodes_raw_staging` と Python 側 `all_nodes` の件数が 5% 以内の乖離
- `new_qids.jsonl` に新規 QID が適切に出力されること

### 3. パフォーマンス

- 従来版と同等かそれ以上（総取得時間が極端に悪化していない）
- P31-only クエリのため、WDQS 側のタイムアウトが減ることを期待

## 受け入れ条件

- [x] `food_class_closure` テーブルが作成されること
- [x] `1_1_5_fetch_and_load_classes.py` が正常に動作すること
- [x] `fetch_food_nodes()` から property path `(wdt:P31|wdt:P279)*` が削除されていること
- [x] WATCH_QIDS のログ出力が実装されていること
- [ ] 実際に `1_1_5` → `1_2` の順に実行して、WATCH_QIDS が全て取得されること
- [ ] `food_nodes_raw` に WATCH_QIDS が全て存在すること
- [ ] staging との乖離が 5% 以内であること

## 今後の課題

### クラス閉包の更新戦略

- 現在は `1_1_5_fetch_and_load_classes.py` を手動実行
- 将来的には定期実行（週次 / 月次）を検討
- root 定義変更時は必ず再実行が必要

### depth の活用

- 現在は `-1`（深度不明）で保存している場合がある
- BFS で正確な depth を計算することも可能だが、今回は省略
- depth を活用した分析（shallow classes vs deep classes）も将来の検討課題

### クエリの最適化

- クラス数が多い場合（数千以上）、VALUES 句が大きくなる
- バッチ分割を検討する必要があるかもしれない
- 現時点では問題なし（数百〜数千程度）

## 参考資料

- Issue: #745 Wikidata food nodes 抽出ロジックの 2 段階化（P31 / P279 closure）
- Migration: `infra/big-query/migration/20260211T0000_create_food_class_closure.sql`
- New Script: `scripts/20251213T0000_wikidata_food_graph/1_1_5_fetch_and_load_classes.py`
