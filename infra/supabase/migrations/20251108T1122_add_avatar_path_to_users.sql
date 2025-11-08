-- 変更チケット: プロフィール画像アップロード＆配信リニューアル
--
-- ## 内容
-- `users` テーブルに `avatar_path` カラム（TEXT・NULL可）を追加する。
-- GCS 内の原本プロフィール画像の恒久キーを保存する（例：`avatars/{user_id}/YYYY/MM/<uuid>.jpg`）
--
-- ## 背景
-- 現在の `avatar` カラムは URL 文字列を直接保存しているが、
-- 今後は GCS に保存した原本パスを基に、派生画像（sm/md/lg）を動的に生成・配信する運用に変更。
-- 毎回新しいファイル名を採番し、キャッシュパージ不要な設計とする。
--
-- ## 対応
-- - `avatar_path` カラム追加（TEXT、NULL可）
-- - 既存の `avatar` カラムは URL 文字列を保持（後方互換性のため残す）
-- - カラムコメント付与
--
-- ## ロールバック
-- - `ALTER TABLE users DROP COLUMN avatar_path;` で元に戻せる

-- =========================================
-- Up
-- =========================================

ALTER TABLE users
  ADD COLUMN avatar_path TEXT;

COMMENT ON COLUMN users.avatar_path
  IS 'GCS 内のプロフィール画像原本パス（例：avatars/{user_id}/YYYY/MM/<uuid>.jpg）。更新のたびに新ファイル名を採番。';

-- =========================================
-- Down (rollback)
-- =========================================

-- ALTER TABLE users
--   DROP COLUMN avatar_path;
