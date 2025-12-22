-- テーブル定義
CREATE TABLE user_roles (
    user_id UUID NOT NULL,
    role_id UUID NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

-- 外部キー制約
ALTER TABLE user_roles
    ADD CONSTRAINT user_roles_role_id_fkey
        FOREIGN KEY (role_id) REFERENCES roles(id)
        ON UPDATE CASCADE ON DELETE CASCADE;

-- インデックス
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

-- テーブルコメント
COMMENT ON TABLE user_roles IS 'ユーザーに割り当てられたロール（多対多）の対応付けテーブル';

-- カラムコメント
COMMENT ON COLUMN user_roles.user_id IS 'ユーザーID（auth.users.id への外部キー）';
COMMENT ON COLUMN user_roles.role_id IS 'ロールID（roles.id への外部キー）';

-- RLS 有効化
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
