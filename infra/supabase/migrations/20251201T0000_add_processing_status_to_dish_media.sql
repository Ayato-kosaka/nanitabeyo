-- 変更チケット: dish_media の加工ステータス管理とフロント挙動の改修 #511
-- ## 内容
-- - `dish_media` に加工ステータスカラムを追加する。
--   - `media_processing_status`: メインメディア（画像/動画）の加工状態
--   - `thumbnail_processing_status`: サムネイル画像の加工状態
-- - 想定値: 'idle', 'processing', 'completed', 'failed'
-- - 既存データは加工完了済みとして 'completed' をデフォルトとして追加後、デフォルト制約を削除する。
------------------------------------------------------------------------------------------------------------
-- ## 背景 / 目的
-- - 画像リサイズ / 動画トランスコードが非同期ジョブで実行されるため、
--   加工完了前に参照すると意図しない表示になる問題があった。
-- - 加工状態をテーブルに持ち、ステータスに応じて返却する URL を制御する。
------------------------------------------------------------------------------------------------------------
-- ## ロールバック
-- - `ALTER TABLE dish_media DROP COLUMN media_processing_status;`
-- - `ALTER TABLE dish_media DROP COLUMN thumbnail_processing_status;`
------------------------------------------------------------------------------------------------------------

-- =========================================
-- Up
-- =========================================

-- 1) 新カラムを追加（既存データは 'completed' として扱う）
ALTER TABLE dish_media
  ADD COLUMN media_processing_status TEXT NOT NULL DEFAULT 'completed';

ALTER TABLE dish_media
  ADD COLUMN thumbnail_processing_status TEXT NOT NULL DEFAULT 'completed';

-- 2) デフォルト制約を削除（新規レコードは明示的にステータスを指定する）
ALTER TABLE dish_media
  ALTER COLUMN media_processing_status DROP DEFAULT;

ALTER TABLE dish_media
  ALTER COLUMN thumbnail_processing_status DROP DEFAULT;

-- 3) コメント追加
COMMENT ON COLUMN dish_media.media_processing_status IS 'メインメディアの加工状態: idle, processing, completed, failed';
COMMENT ON COLUMN dish_media.thumbnail_processing_status IS 'サムネイル画像の加工状態: idle, processing, completed, failed';

-- =========================================
-- Down (rollback)
-- =========================================
-- 元に戻す場合は、追加したカラムを削除する
-- ALTER TABLE dish_media DROP COLUMN IF EXISTS media_processing_status;
-- ALTER TABLE dish_media DROP COLUMN IF EXISTS thumbnail_processing_status;
