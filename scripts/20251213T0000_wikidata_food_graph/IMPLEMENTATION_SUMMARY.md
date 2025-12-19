# BigQuery Load Job Migration - Implementation Summary

## 概要

`3_2_refresh_dish_category_catalog_core.py` の BigQuery データ取り込み処理を、`insertAll` (insert_rows_json) から `Load Job` (load_table_from_file) に移行し、文字列フィールドに 10,000 文字の上限を設定する truncate 機能を追加しました。

## 変更内容

### 1. 文字列 Truncate 機能の追加

#### 定数の追加
```python
MAX_STRING_LENGTH = 10000  # 1フィールドあたりの最大文字数
MAX_ALIASES_COUNT = 1000   # aliases配列の最大要素数
```

#### 追加された関数

##### `truncate_string(value, max_length)`
- 単純文字列の切り詰め
- None 安全

##### `truncate_multilang_field(field_value, max_length)`
- 多言語 JSON フィールド（labels_json, descriptions_json）の切り詰め
- 各言語の文字列を個別に切り詰め
- JSON 全体が max_length を超える場合は、優先言語順（en, ja, ar, es, fr, hi, ko, zh）に言語を保持
- JSON エスケープを考慮したサイズ見積もり（安全マージン 20%）

##### `truncate_aliases_field(field_value, max_length, max_count)`
- aliases_json フィールドの切り詰め
- 要素数制限（1,000 件）
- 各要素の文字数制限（10,000 文字）

##### `apply_truncation(core_data)`
- 全フィールドに truncate を適用
- 切り詰め統計情報を返す
- in-place で core_data を変更

### 2. Load Job への移行

#### 変更された関数

##### `load_core_data_to_bigquery(bq_loader, core_data)`

**旧実装:**
```python
# insertAll を使用
errors = bq_loader.client.insert_rows_json(temp_table_id, batch)
```

**新実装:**
```python
# 1. truncate 処理を適用
truncate_stats = apply_truncation(core_data)

# 2. JSONL 形式で一時ファイルに書き出し
with tempfile.NamedTemporaryFile(...) as temp_file:
    for item in core_data:
        temp_file.write(json.dumps(row, ensure_ascii=False) + '\n')

# 3. Load Job でロード
job_config = bigquery.LoadJobConfig(
    source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    schema=schema,
    write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
)
load_job = bq_loader.client.load_table_from_file(
    source_file, temp_table_id, job_config=job_config
)
load_job.result()

# 4. エラーチェック
if load_job.errors:
    logger.error(f"Load job errors: {load_job.errors}")
    raise Exception(...)
```

##### `delete_stale_entries(bq_loader, candidate_qids)`
- 同様に insertAll から Load Job に移行
- 一貫性のため

### 3. エラーハンドリング

- ジョブエラーをログ出力
- 例外を再スロー
- 一時ファイルを finally 句で安全に削除（未定義チェック付き）

```python
finally:
    if temp_file is not None and 'temp_file_path' in locals() and os.path.exists(temp_file_path):
        try:
            os.unlink(temp_file_path)
            logger.info(f"Deleted temporary JSONL file: {temp_file_path}")
        except Exception as e:
            logger.warning(f"Failed to delete temporary file {temp_file_path}: {e}")
```

## 受け入れ条件の確認

| # | 条件 | 状態 | 備考 |
|---|------|------|------|
| 1 | insertAll を呼ばない | ✅ 完了 | insert_rows_json の使用なし |
| 2 | 13451 items 以上で 413 が発生しない | ⏳ 要検証 | Load Job はファイルベースなのでリクエストサイズ制限なし |
| 3 | 文字列が 10,000 文字を超えない | ✅ 完了 | truncate 処理で保証 |
| 4 | 既存の後続処理が動作する | ⏳ 要検証 | MERGE/DELETE 処理は変更なし |
| 5 | ロード失敗時に例外とログが出力される | ✅ 完了 | エラーハンドリング実装済み |

## テスト方法

### 手動テスト

```bash
cd /home/runner/work/nanitabeyo/nanitabeyo/scripts/20251213T0000_wikidata_food_graph

# 実行前に環境変数を設定（必要に応じて）
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json

# スクリプト実行
python3 3_2_refresh_dish_category_catalog_core.py
```

### 確認ポイント

1. **Truncate ログの確認**
   ```
   Applying truncation to XXXX items...
   Truncation statistics:
     labels_json: XX items truncated
     aliases_json_elements: XX items truncated
   ```

2. **JSONL ファイルサイズの確認**
   ```
   JSONL file written: XX.XX MB
   ```

3. **Load Job の成功確認**
   ```
   Loaded XXXX rows to temp table
   ```

4. **エラーがないことの確認**
   - ジョブエラーログが出力されていないこと
   - 一時ファイルが削除されていること

## リスク管理

### 対策済みリスク

1. **型の揺れ**: 既存 schema に合わせて型を正規化
2. **ディスク容量**: 一時ファイルは処理後に必ず削除
3. **メモリ使用量**: ストリーミング書き込みで一定

### 既知の制限

1. **aliases の巨大配列**: 1,000 件制限で対処（将来は別テーブル正規化も検討）
2. **JSON エスケープの見積もり誤差**: 安全マージン 20% で対処

## 変更ファイル

- `scripts/20251213T0000_wikidata_food_graph/3_2_refresh_dish_category_catalog_core.py`
  - 追加: truncate 関連関数 5 つ（約 200 行）
  - 変更: `load_core_data_to_bigquery()` 関数（約 100 行）
  - 変更: `delete_stale_entries()` 関数（約 80 行）

## セキュリティ

- CodeQL スキャン: ✅ 問題なし（0 alerts）

## 次のステップ

1. 本番環境でのテスト実行
2. パフォーマンスの測定（処理時間、ディスク使用量）
3. 将来的な改善案の検討（Parquet 形式への移行など）
