CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA extensions;

CREATE TABLE users (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username     CITEXT      NOT NULL,
    display_name TEXT,
    avatar       TEXT,
    bio          TEXT,
    last_login_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_no      INTEGER     NOT NULL DEFAULT 0
);

-- UNIQUE：大小無視で一意
CREATE UNIQUE INDEX uq_users_username ON users (username);

COMMENT ON TABLE users IS 'アプリ利用者プロフィール・認証情報';
COMMENT ON COLUMN users.id IS 'ユーザ ID';
COMMENT ON COLUMN users.username IS 'ログイン用ユーザ名 (CITEXT)';
COMMENT ON COLUMN users.lock_no IS '楽観ロック用バージョン番号';

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
