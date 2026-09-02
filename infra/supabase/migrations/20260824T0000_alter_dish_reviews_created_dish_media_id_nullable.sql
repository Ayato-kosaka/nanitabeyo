-- NOTE: 旧 20260819T0000_alter_dish_reviews_created_dish_media_id_nullable.sql からのリネーム（#1469 ブランチが dev へ旧名で先行適用済み。SQL 本体は同一で、全体が冪等なので再適用は無害）。
-- リネーム理由: main の 20260823T0000 より後ろに並べ、「ファイル名順 = 適用順」を守るため。
-- ==============================================================================
-- 20260819T0000_alter_dish_reviews_created_dish_media_id_nullable.sql
-- #1395（親 #1375）
-- ==============================================================================
-- 【目的】
--   「食べた」を写真なしで記録できるようにするため、
--   dish_reviews.created_dish_media_id の NOT NULL 制約を外す。
--
-- 【背景】
--   - 20250802T0304_create_dish_reviews.sql:12 のとおり、この列は
--       created_dish_media_id UUID NOT NULL,
--     で定義されており、**FK は存在しない**
--     （「メディアに対するレビューではないため references は貼らない」という当時の判断）。
--   - したがって NOT NULL 解除は FK の張り替えを伴わない単独の
--     ALTER COLUMN ... DROP NOT NULL で済む。
--   - 前例: 20250903T1030_drop_not_null_plus_code_from_restaurants.sql と同形。
--
-- 【コスト】
--   NOT NULL の解除は pg_attribute のカタログ更新のみでテーブル書き換えを伴わない。
--   dish_reviews は約 964MB（DB 使用容量の約 60%。20260718T0000 のヘッダ参照）だが、
--   この ALTER は一瞬で終わる。ACCESS EXCLUSIVE ロックは取るため、
--   長時間クエリが走っていない時間帯に適用すること。
--
-- 【デプロイ順序（不可逆点があるため厳守）】
--   [1] 本マイグレーションを適用する（ここまでは既存コードのまま動く）
--   [2] API / フロントの型追従をデプロイする
--   [3] ここで初めて createdDishMediaId 省略の書き込みを許可する
--   [3] を [1] より先に出すと 500 になる。逆順にしないこと。
--
-- 【ロールバック】
--   ALTER TABLE dish_reviews ALTER COLUMN created_dish_media_id SET NOT NULL;
--   ただし NULL 行が 1 件でも入ったら戻せない（実質片道）。
--   上記 [3] を実行する前なら戻せる。
--
-- 【影響範囲（#1395 設計書 §1 で全列挙済み）】
--   - 集計は全て dish_id 経由であり、created_dish_media_id を見ていないため
--     店舗の reviewCount / averageRating は壊れない
--     （restaurants.repository.ts / dish-media.repository.ts の avgByDish）。
--   - 写真なしレビューも従来どおり公開レビューとして平均評価に載る。
--     これは #1375 の「決定1: レビューは全ユーザー公開」で確定した意図した仕様。
--   - BigQuery へ dish_reviews を同期するコードは本リポジトリに存在しない。
-- ==============================================================================

ALTER TABLE dish_reviews ALTER COLUMN created_dish_media_id DROP NOT NULL;

COMMENT ON COLUMN dish_reviews.created_dish_media_id IS
  'レビュー作成時に投稿したメディア。写真なしで「食べた」を記録できるため NULL 可（#1395）。メディアに対するレビューではないため FK は張らない（20250802T0304 の判断を踏襲）';
