-- テーブル定義
CREATE TABLE permissions (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL
);

-- 制約
ALTER TABLE permissions
    ADD CONSTRAINT permissions_name_unique UNIQUE (name);

-- インデックス
CREATE INDEX idx_permissions_name ON permissions(name);

-- テーブルコメント
COMMENT ON TABLE permissions IS 'システム内で利用可能な権限（操作）を管理するマスタテーブル';

-- カラムコメント
COMMENT ON COLUMN permissions.id IS '権限ID（UUID）';
COMMENT ON COLUMN permissions.name IS '権限名（例: post.read, post.create）';
COMMENT ON COLUMN permissions.description IS '権限の説明';

-- RLS 有効化
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
