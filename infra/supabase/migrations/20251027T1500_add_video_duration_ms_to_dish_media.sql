-- 変更チケット: #379
--
-- ## 内容
-- `dish_media` に動画長を保持するカラム `video_duration_ms`（ミリ秒・INTEGER・NULL可）を追加する。
-- 画像(`media_type='image'`)では NULL、動画(`media_type='video'`)では値を保持する想定。
--
-- ## 背景
-- avg_watch_rate を算出するため、動画長を `dish_media_analysis_results` ではなく
-- 元データの `dish_media` に持たせる方針へ変更。
--
-- ## 対応
-- - カラム追加（まだ制約は課さない／バックフィル後に別マイグレーションで厳格化予定）
-- - カラムコメント付与
--
-- ## ロールバック
-- - `ALTER TABLE dish_media DROP COLUMN video_duration_ms;` で元に戻せる
--   （バックフィルで埋めた値は失われる）

-- =========================================
-- Up
-- =========================================

ALTER TABLE dish_media
  ADD COLUMN video_duration_ms INTEGER CHECK (video_duration_ms >= 0);

COMMENT ON COLUMN dish_media.video_duration_ms
  IS '動画長（ミリ秒）。media_type=''video'' のみ設定、image は NULL。';

-- 将来的に制約をかける場合（バックフィル完了後、別マイグレーションで実施想定）:
-- ALTER TABLE dish_media
--   ADD CONSTRAINT dish_media_video_duration_ck NOT VALID
--   CHECK (
--     (media_type = 'video' AND video_duration_ms IS NOT NULL AND video_duration_ms BETWEEN 100 AND 21600000)
--     OR (media_type = 'image' AND video_duration_ms IS NULL)
--   );
-- ALTER TABLE dish_media VALIDATE CONSTRAINT dish_media_video_duration_ck;

-- =========================================
-- Down (rollback)
-- =========================================

-- ALTER TABLE dish_media
--   DROP COLUMN video_duration_ms;
