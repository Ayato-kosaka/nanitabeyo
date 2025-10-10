-- 変更チケット: #340
-- ## 内容
-- `/v1/dish-category-variants?q=...` での前方一致検索において、`dish_category_variants` テーブルで **Seq Scan** が発生し、レスポンス遅延（~200–500ms）が発生している。

-- ## 原因
-- * 現行は `GIN (surface_form gin_trgm_ops)` のみを保有。
-- * 要件は **前方一致・完全一致・IN（完全一致）** のみであり、**包含検索（%…%）や類似度検索**は不要。
-- * そのため、**前方一致最適の btree + `text_pattern_ops`** が無く、プランナが Seq Scan を選択。

-- ## 対応
-- 1. **前方一致専用のカバリング btree インデックス**を追加
--    * `ON (surface_form text_pattern_ops, dish_category_id)`
--    * 集約/結合時のI/Oも削減
-- 2. 不要な **trigram GIN インデックス**を削除
--    * 書き込みコスト/ディスク使用の削減
--      3)（実装側確認）前方一致は `LIKE 'prefix%'` を使用（`ILIKE` 不要。列は全て小文字）

-- ## 影響範囲
-- * 読み取り性能：前方一致クエリが **Index Scan** 化し、p95で十数ms程度まで短縮見込み
-- * 書き込み性能：不要インデックス削除により僅かに改善

-- 1) 前方一致用：カバリング btree インデックス
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dcv_surface_form_prefix_cover
  ON dish_category_variants (surface_form text_pattern_ops, dish_category_id);

-- 2) 不要な trigram GIN を削除（包含/類似検索の要件がないため）
DROP INDEX CONCURRENTLY IF EXISTS idx_dcv_surface_form_trgm;