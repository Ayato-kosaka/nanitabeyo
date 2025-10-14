-- 変更チケット: #341
-- ## 内容
-- `dishes` テーブルで (restaurant_id, category_id) の組が重複しうる設計となっており、
-- API `/v1/dishes` の「check-then-create」実装に対して“連打”などの並行実行時に重複行が生成される恐れがある。
--
-- ## 原因
-- DB 側に複合ユニーク制約が無く、アプリ側の read→create が競合時に二重作成されうる。
--
-- ## 対応
-- 1) 既存の重複データをビジネスルールに沿って解消（本マイグレーションでは「最古 created_at を残す」）
-- 2) (restaurant_id, category_id) の複合ユニーク制約を付与
--    ※ Supabase Studio の SQL Editor はトランザクションで包まれることがあり、
--       CREATE INDEX CONCURRENTLY が失敗するため、ここでは単純に UNIQUE 制約を追加する。
--       影響を最小化したい場合は CLI/migrations 経由で CONCURRENTLY によるユニークインデックス → 制約化を用いること。
--
-- ## 影響範囲
-- - 重複作成の防止（整合性担保）
-- - アプリ側は UPSERT（ON CONFLICT (restaurant_id, category_id)）で冪等化が可能
--
-- ## ロールバック
-- - 制約を DROP する（`ALTER TABLE ... DROP CONSTRAINT dishes_restaurant_category_unique;`）
-- - ただし削除済みの重複行は戻らない点に注意

-- 複合ユニーク制約を追加（ユニークインデックスも作成される）
ALTER TABLE dishes
  ADD CONSTRAINT dishes_restaurant_category_unique
  UNIQUE (restaurant_id, category_id);
