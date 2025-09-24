-- 開発チケット: #260
-- 内容:
-- Supabase ログイン機能の追加（匿名ユーザー ID 引き継ぎ対応）
--   - `users` テーブルに Row Level Security (RLS) を設定
--   - ユーザー自身のレコードのみ参照・作成・更新可能に制限
--
-- 原因:
--   - これまで RLS 未設定のため、アプリ側で明示的に制御しなければ
--     他ユーザーのレコードへアクセスできてしまうリスクがあった
--
-- 対応:
--   - 外部キー制約は導入せず、`users.id` と `auth.uid()` の一致によってアクセスを制御
--   - これにより匿名ユーザーからログインユーザーへの移行時も柔軟に対応可能
--
-- 影響範囲:
--   - 既存アプリケーションコード: RLS によって自身のレコードしか取得・更新できなくなる
--   - サービスロールキーでの管理処理には影響なし（RLS をバイパスできる）
--
-- 移行後の確認:
--   - 匿名ログイン・通常ログインともに、自分の `users` レコードだけ取得・更新できること

BEGIN;

-- RLS を有効化
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 冪等性のため既存ポリシーを削除
DROP POLICY IF EXISTS users_select_own ON users;
DROP POLICY IF EXISTS users_insert_own ON users;
DROP POLICY IF EXISTS users_update_own ON users;

-- 自分の行のみ参照可
CREATE POLICY users_select_own
  ON users
  FOR SELECT
  USING (auth.uid() = id);

-- 自分の行のみ作成可
CREATE POLICY users_insert_own
  ON users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 自分の行のみ更新可
CREATE POLICY users_update_own
  ON users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

COMMIT;
