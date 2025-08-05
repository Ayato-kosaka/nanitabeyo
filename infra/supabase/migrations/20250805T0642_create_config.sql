-- テーブル定義
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT
);

-- インデックス（必要な列に対して）
-- ※PRIMARY KEYにインデックスは自動作成されるため不要

-- コメント（テーブル）
COMMENT ON TABLE config IS 'アプリの動作に関わる設定値を保持するテーブル';

-- コメント（カラム）
COMMENT ON COLUMN config.key IS '設定値のキー（例：v1_min_frontend_log_level）';
COMMENT ON COLUMN config.value IS '設定値の値（例：info, 2 など）';
COMMENT ON COLUMN config.description IS '設定内容の補足説明（任意）';

-- RLS 有効化
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
