-- ==============================================================================
-- 20260826T0100_add_soft_delete_and_edit_columns_to_dish_media_and_dish_reviews.sql
-- #1513 (UGC-01 自分の投稿・レビューを編集／削除する)
-- ==============================================================================
-- 【目的】
-- 自分の投稿（dish_media）と自分のレビュー（dish_reviews）を
--   - 編集できる（テキスト・評価などのメタデータのみ。メディアは差し替えない）
--   - 削除できる（**論理削除**）
-- ようにするために必要なカラムを追加する。
--
-- 【背景】
-- - `dish_reviews` には `deleted_at` も `updated_at` も `lock_no` も無く、
--   編集も削除も表現できない。`created_at` しか無い。
-- - `dish_media` には `updated_at` / `lock_no` はあるが `deleted_at` が無い。
--   `media_processing_status` は変換パイプラインの状態であって公開制御ではないため、
--   これを流用して「消えたことにする」のは誤り。
--
-- 【実装方針】
-- - **物理削除ではなく論理削除**を採る。物理削除は
--     * `dish_media_likes.dish_media_id` が ON DELETE NO ACTION
--     * `payouts.dish_media_id` が売上明細として残る必要がある
--     * GCS 上のメディア実体と `notifications.target_id` が宙吊りになる
--   ため、参照側の後始末が広範囲になる。`deleted_at IS NULL` を読み取り経路へ足すほうが小さい。
-- - 競合検知は既存の `dish_media.lock_no` と同じ「単調増加する整数」に揃える。
--   `dish_reviews` にも `lock_no` を足し、更新時に
--   `WHERE id = ? AND lock_no = ?` で **後勝ちを禁止**する（不一致は 409 Conflict）。
-- - `updated_at` は `dish_media` / `users` と同じく **アプリ側で明示的に更新する**。
--   このリポジトリには更新トリガが無く、トリガだけこのテーブルに入れると流儀が割れるため。
-- - 既存行のバックフィルは不要。
--     * `deleted_at` は NULL（= 未削除）が正しい初期値。
--     * `updated_at` は `DEFAULT now()` を付けて追加するので、既存行には
--       「マイグレーション適用時刻」が入る。**本当の最終更新時刻ではない**が、
--       `dish_reviews` に更新の概念自体が無かった以上、遡って復元できる値も無い。
--       表示は `created_at` を使い続け、`updated_at` は編集検知の内部用途に限る。
--     * `lock_no` は 0 始まり（`dish_media` と同じ）。
--
-- 【インデックス】
-- - 読み取り経路はすべて `deleted_at IS NULL` を伴うため、既存インデックスを
--   そのまま使える形（部分インデックス）で足す。全件に張ると
--   `dish_reviews`（約 964MB / DB 使用容量の約 60%）でコストが見合わない。
-- - `CREATE INDEX CONCURRENTLY` はトランザクション内で実行できないため、
--   このファイルは BEGIN / COMMIT で囲まない（#896 の migration と同じ理由）。
--
-- 【後方互換性】
-- - 追加カラムはすべて NULL 許容もしくは DEFAULT 付きのため、既存の INSERT は壊れない。
-- - 既存の SELECT は `deleted_at` を見ないので、**このマイグレーションだけを適用しても
--   挙動は一切変わらない**。論理削除が効くのは API 側の `deleted_at IS NULL` が入ってから。
-- - よって「マイグレーション → API デプロイ」の順で安全に適用できる（逆順は不可。
--   API が先に出ると存在しないカラムを参照して 500 になる）。
--
-- 【ロールバック】
--   DROP INDEX CONCURRENTLY IF EXISTS idx_dish_media_alive_dish;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_dish_reviews_alive_dish;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_dish_reviews_alive_user_created_at;
--   ALTER TABLE dish_media   DROP COLUMN deleted_at;
--   ALTER TABLE dish_reviews DROP COLUMN deleted_at;
--   ALTER TABLE dish_reviews DROP COLUMN updated_at;
--   ALTER TABLE dish_reviews DROP COLUMN lock_no;
-- ==============================================================================

-- =========================================
-- Up
-- =========================================

-- 1) dish_media: 論理削除カラム
ALTER TABLE dish_media
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN dish_media.deleted_at IS
  '論理削除日時。NULL は未削除。NOT NULL の行は一覧・検索・詳細・OGP・通知のどの経路からも返さない。物理削除は dish_media_likes / payouts / GCS 実体との整合が取れないため行わない';

-- 2) dish_reviews: 論理削除カラム
ALTER TABLE dish_reviews
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN dish_reviews.deleted_at IS
  '論理削除日時。NULL は未削除。NOT NULL の行は一覧・検索・詳細・平均評価の集計のどの経路からも返さない';

-- 3) dish_reviews: 更新日時
--    既存行には適用時刻が入る（本当の最終更新時刻は復元できない。ヘッダのコメント参照）
ALTER TABLE dish_reviews
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN dish_reviews.updated_at IS
  '最終更新日時。アプリ側で明示的に更新する（このリポジトリには更新トリガを置かない）。表示上の投稿日時は created_at を使う';

-- 4) dish_reviews: 楽観ロック番号（dish_media.lock_no と同じ意味・同じ 0 始まり）
ALTER TABLE dish_reviews
  ADD COLUMN IF NOT EXISTS lock_no integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN dish_reviews.lock_no IS
  '楽観ロック番号。更新は WHERE id = ? AND lock_no = ? で行い、更新できなければ 409 Conflict を返す。これにより同時編集の後勝ちを禁止する';

-- 5) 読み取り経路（deleted_at IS NULL）向けの部分インデックス
--    既存の idx_dish_media_dish / idx_dish_reviews_dish /
--    idx_dish_reviews_user_created_at に対応する「生存行だけ」の版。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dish_media_alive_dish
  ON dish_media (dish_id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dish_reviews_alive_dish
  ON dish_reviews (dish_id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dish_reviews_alive_user_created_at
  ON dish_reviews (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
