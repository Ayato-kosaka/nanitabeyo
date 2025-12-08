-- テーブル定義
CREATE TABLE roles (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL
);

-- 制約
ALTER TABLE roles
    ADD CONSTRAINT roles_name_unique UNIQUE (name);

-- インデックス
CREATE INDEX idx_roles_name ON roles(name);

-- テーブルコメント
COMMENT ON TABLE roles IS 'アプリケーションで利用するロール（権限グループ）のマスタテーブル';

-- カラムコメント
COMMENT ON COLUMN roles.id IS 'ロールID（UUID）';
COMMENT ON COLUMN roles.name IS 'ロール名（例: admin, editor, viewer）';
COMMENT ON COLUMN roles.description IS 'ロールの説明';

-- RLS 有効化
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
