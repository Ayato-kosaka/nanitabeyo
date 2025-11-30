-- #511 【設計】dish_media に加工ステータスカラムを追加
-- media_processing_status: メインメディア（画像/動画）の加工状態
-- thumbnail_processing_status: サムネイル画像の加工状態
-- 想定値: 'idle', 'processing', 'completed', 'failed'

-- カラム追加（デフォルト値を 'processing' に設定）
ALTER TABLE dish_media
  ADD COLUMN media_processing_status TEXT NOT NULL DEFAULT 'processing';

ALTER TABLE dish_media
  ADD COLUMN thumbnail_processing_status TEXT NOT NULL DEFAULT 'processing';

-- 既存データは加工完了済みとして 'completed' に更新
UPDATE dish_media
SET media_processing_status = 'completed',
    thumbnail_processing_status = 'completed';

COMMENT ON COLUMN dish_media.media_processing_status IS 'メインメディアの加工状態: idle, processing, completed, failed';
COMMENT ON COLUMN dish_media.thumbnail_processing_status IS 'サムネイル画像の加工状態: idle, processing, completed, failed';
