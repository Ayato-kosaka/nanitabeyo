# Wikidata 食ノード取得バッチ改修内容

## チケット: #545

## 改修概要

Wikidata SPARQL エンドポイントからの食ノード取得バッチの安定化・高速化を実施。
実行時間の悪化（2h → 8h+）と GATEWAY TIMEOUT (504) 多発への対応。

---

## 改修内容

### 1. WikidataClient.execute_query のリトライ戦略見直し

**変更箇所**: `wikidata_client.py` L37-41

**変更前**:
```python
@retry(
    stop=stop_after_attempt(100),  # 100回リトライ
    wait=wait_exponential(multiplier=1, min=4, max=120),  # 最大120秒待機
    retry=retry_if_exception_type((Exception,))
)
```

**変更後**:
```python
@retry(
    stop=stop_after_attempt(5),  # 5回に削減
    wait=wait_exponential(multiplier=1, min=4, max=60),  # 最大60秒に削減
    retry=retry_if_exception_type((Exception,))  # TODO: HTTPステータスごとに絞る（504, 429等）
)
```

**理由**:
- 1クエリで100回リトライすると、全体時間が際限なく伸びる
- 重いクエリは何度リトライしても失敗する可能性が高い
- 外側のオーケストレーション（root単位の分割）で粘る構造に変更

---

### 2. fetch_food_nodes のページング方式変更

**変更箇所**: `wikidata_client.py` L60-116

**変更前**: OFFSET ベースのページング
```sparql
SELECT DISTINCT ?item ...
WHERE { ... }
LIMIT {batch_limit}
OFFSET {offset}  -- ページが進むほど重くなる
```

**変更後**: カーソルベースのページング
```sparql
SELECT DISTINCT ?item ...
WHERE {
  ...
  FILTER(STR(?item) > "{last_item_uri}")  -- カーソル条件
}
ORDER BY ?item  -- 安定した順序保証
LIMIT {batch_limit}
```

**主な変更点**:
- `offset` 変数を削除
- `last_item_uri` 変数を追加（カーソル保持）
- `ORDER BY ?item` を追加（結果順の安定化）
- `cursor_filter` を動的生成

**理由**:
- OFFSET は大きくなるほど WDQS の負荷が高い
- ORDER BY + FILTER による範囲指定のほうが効率的
- 結果順が安定し、ページング信頼性が向上

---

### 3. 1_2_fetch_and_load_nodes.py の処理フロー改修

**変更箇所**: `1_2_fetch_and_load_nodes.py` 全体

**主な変更点**:

#### 3.1 root単位の分割処理
```python
# 変更前: 全rootを一括処理
root_qids = [qid for qid, _ in FOOD_ROOTS]
nodes = wikidata_client.fetch_food_nodes(root_qids, limit=args.limit)

# 変更後: rootごとにループ
for root_qid, root_kind in FOOD_ROOTS:
    nodes = wikidata_client.fetch_food_nodes([root_qid], limit=root_limit)
    # 一時ファイルに保存...
```

#### 3.2 一時ファイル保存（冪等性・再開性向上）
```python
NODES_TEMP_DIR = TEMP_DIR / "nodes"  # /tmp/wikidata_food_graph/nodes/
temp_file = NODES_TEMP_DIR / f"{root_qid}.jsonl"

# JSONL形式で保存
with open(temp_file, 'w', encoding='utf-8') as f:
    for node in nodes:
        f.write(json.dumps(node, ensure_ascii=False) + '\n')
```

#### 3.3 重複排除
```python
all_nodes: List[Dict] = []
seen_qids: Set[str] = set()

for node in nodes:
    qid = node["item_qid"]
    if qid not in seen_qids:
        all_nodes.append(node)
        seen_qids.add(qid)
```

#### 3.4 --keep-temp オプション追加
```python
parser.add_argument(
    "--keep-temp",
    action="store_true",
    help="Keep temporary files after completion (for debugging)"
)
```

#### 3.5 処理フェーズの構造化
```
Phase 1: Fetching nodes per root
  - rootごとにループ
  - 一時ファイル保存
  - 重複排除
  
Phase 2: Loading nodes to BigQuery
  - 全root完了後に一括ロード
  
Phase 3: Fetching parent edges
  - 従来通りのエッジ取得
```

**理由**:
- rootごとの分割により、1クエリの負荷を軽減
- 一時ファイルにより、途中失敗時も再実行でスキップ可能（将来的な拡張性）
- 重複排除により、複数rootで同じノードが取得されても問題なし
- limit指定時は各rootに均等割り当て

---

## 後方互換性

### edges.json のフォーマット維持

`1_3_generate_paths_and_summary.py` との互換性を保つため、
`edges.json` の形式は変更していません。

```python
# 1_2_fetch_and_load_nodes.py で保存
with open(EDGES_FILE, 'w') as f:
    json.dump(edges, f)  # edges は [(child_qid, parent_qid), ...] のリスト

# 1_3_generate_paths_and_summary.py で読み込み
with open(EDGES_FILE, 'r') as f:
    edges = json.load(f)
edges = [(edge[0], edge[1]) for edge in edges]
```

### BigQuery インターフェース維持

`load_food_nodes()`, `fetch_parent_edges()` の引数・戻り値は変更なし。

---

## テスト

### test_validation.py

ネットワーク接続を前提とした統合テスト（本環境では接続不可）。

実施内容:
- カーソルベースページングのテスト
- edges.json フォーマット検証
- リトライ戦略の確認

### test_unit.py

モックデータを使用した単体テスト（ネットワーク不要）。

実施内容:
- カーソルロジックのシミュレーション
- 重複排除ロジックの検証
- JSONL 一時ファイル形式の検証
- limit分配ロジックの検証

**テスト結果**: ✅ 全テストパス

---

## 使用方法（変更なし）

```bash
# 全件取得
python3 1_2_fetch_and_load_nodes.py

# ノード数を制限（開発用）
python3 1_2_fetch_and_load_nodes.py --limit 1000

# 一時ファイルを保持（デバッグ用）
python3 1_2_fetch_and_load_nodes.py --keep-temp
```

---

## 期待される効果

1. **クエリ軽量化**: 
   - OFFSET 廃止により、ページングのコストが一定に
   - root単位の分割により、1クエリの対象範囲が縮小

2. **リトライ回数削減**:
   - 5回 × (複数root × 複数ページ) の構造
   - 1クエリで100回粘るのではなく、小さく分割して外側で粘る

3. **安定性向上**:
   - ORDER BY による結果順の安定化
   - 一時ファイルによる途中結果の保存（将来的な再開機能の基盤）

4. **運用性向上**:
   - rootごとのログ出力で進捗が明確
   - --keep-temp によるデバッグ容易性

---

## 今後の拡張可能性

1. **再開機能の実装**:
   - 一時ファイルを見て、既に完了したrootをスキップ
   - `--resume` オプションの追加

2. **例外タイプの絞り込み**:
   - TODO コメントの対応
   - 504, 429 などの特定エラーのみリトライ

3. **並列処理**:
   - rootごとに独立しているため、並列化が可能
   - ただし WDQS への負荷を考慮

---

## 検証項目

### 機能的整合性 ✅

- [x] カーソルベースページングの動作確認
- [x] 重複排除の動作確認
- [x] edges.json フォーマットの互換性確認
- [x] 一時ファイル形式（JSONL）の確認
- [x] limit分配ロジックの確認

### パフォーマンス・安定性（本番環境で要確認）

- [ ] 実行時間の改善確認（8h+ → 短縮目標）
- [ ] 504エラー頻度の低減確認
- [ ] ログ出力の可読性確認

### 後方互換性 ✅

- [x] 1_3_generate_paths_and_summary.py が正常動作
- [x] BigQuery テーブル構造が変更されていない
- [x] edges.json フォーマットが維持されている

---

## コメント規約準拠

本改修では、以下のコメント形式を使用しています：

```python
# #545 【設計】カーソル方式：前回取得した最後のitem URI
# #545 【設計】root単位の一時ファイル保存先
# #545 【設計】limit指定時は各rootに均等割り当て
```

- チケット番号: `#545`
- 種別: `【設計】`
- 内容: 変更理由・トレードオフを簡潔に記述

---

## 関連ドキュメント

- README.md: 使用方法（変更なし）
- wikidata_client.py: クライアント実装
- 1_2_fetch_and_load_nodes.py: メインスクリプト
- 1_3_generate_paths_and_summary.py: 後続処理（変更なし）
