-- 変更チケット: users にアカウント共通の既定ロケール preferred_locale を追加
--
-- ## 内容
-- `users` テーブルに `preferred_locale` カラム（TEXT, NOT NULL）を追加する。
-- 端末ごとの上書き設定が無い場合、この値を通知や UI の既定ロケールとして用いる。
--
-- ## 背景
-- これまでは端末単位の `user_device_tokens.locale` のみを参照していたが、
-- Instagram ライクな「端末で上書き／未設定ならアカウント既定」というフォールバックを実現するため、
-- ユーザープロファイル側にアカウント共通の既定ロケールを持たせる。
--
-- ## 対応
-- - `preferred_locale` カラム追加（TEXT, NOT NULL）
-- - 簡易な BCP47 形式を想定した CHECK 制約 `users_preferred_locale_check` を追加
--   - パターン: `^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$`
-- - カラムコメント付与
--
-- ## ロールバック
-- - `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_preferred_locale_check;`
-- - `ALTER TABLE users DROP COLUMN preferred_locale;`
--
-- ※ 注意:
--   既存データがある環境で直接 NOT NULL を追加する場合、
--   すべての既存行に対して一時的なデフォルト値を入れる等のケアが必要です。

-- =========================================
-- Up
-- =========================================

ALTER TABLE users
  ADD COLUMN preferred_locale TEXT NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_preferred_locale_check CHECK (
    preferred_locale ~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$'::text
  );

COMMENT ON COLUMN users.preferred_locale
  IS 'アカウント共通の既定ロケール（例: ja, en-US）。端末ごとのロケール指定が無い場合に通知やUIの既定言語として用いる。';

-- =========================================
-- Down (rollback)
-- =========================================

-- ロールバック時は以下を実行:

-- ALTER TABLE users
--   DROP CONSTRAINT IF EXISTS users_preferred_locale_check;

-- ALTER TABLE users
--   DROP COLUMN preferred_locale;
