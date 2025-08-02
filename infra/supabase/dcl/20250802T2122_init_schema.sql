-- =============================================
-- 📄 スキーマ初期化スクリプト
-- 作成日: 2025-04-27
-- =============================================

-- (1) public スキーマは標準で存在するので、コメントだけ
COMMENT ON SCHEMA public IS 'アプリ本番用データスキーマ（公開範囲）';

-- (2) dev スキーマ（開発用）
CREATE SCHEMA IF NOT EXISTS dev;
COMMENT ON SCHEMA dev IS '開発環境用データスキーマ';

-- (3) test スキーマ（テスト用）
CREATE SCHEMA IF NOT EXISTS test;
COMMENT ON SCHEMA test IS 'テスト環境用データスキーマ';

-- (4) staging スキーマ（必要なら）
-- CREATE SCHEMA IF NOT EXISTS staging;
-- COMMENT ON SCHEMA staging IS 'ステージング環境用データスキーマ';

-- =============================================
-- 補足
-- - public: 本番ユーザーがアクセスするメインスキーマ
-- - dev: 開発中の機能検証スキーマ
-- - test: 自動テストやE2Eテスト専用スキーマ
-- - staging: 本番リハーサル用スキーマ（今後必要になれば）
-- =============================================
