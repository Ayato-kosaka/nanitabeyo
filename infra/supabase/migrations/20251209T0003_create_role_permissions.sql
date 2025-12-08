-- テーブル定義
CREATE TABLE role_permissions (
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);

-- 外部キー制約
ALTER TABLE role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey
        FOREIGN KEY (role_id) REFERENCES roles(id)
        ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey
        FOREIGN KEY (permission_id) REFERENCES permissions(id)
        ON UPDATE CASCADE ON DELETE CASCADE;

-- インデックス
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);

-- テーブルコメント
COMMENT ON TABLE role_permissions IS 'ロールに付与されている権限の対応付け（多対多）を管理するテーブル';

-- カラムコメント
COMMENT ON COLUMN role_permissions.role_id IS 'ロールID（roles.id への外部キー）';
COMMENT ON COLUMN role_permissions.permission_id IS '権限ID（permissions.id への外部キー）';

-- RLS 有効化
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
