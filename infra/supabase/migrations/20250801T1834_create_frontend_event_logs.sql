-- ENUM型の定義（テーブルに合わせて一意な名前）
CREATE TYPE frontend_event_logs_error_level AS ENUM ('trace', 'debug', 'info', 'warn', 'error');

-- テーブル定義
CREATE TABLE frontend_event_logs (
    id TEXT PRIMARY KEY,
    user_id UUID,
    event_name TEXT,
    error_level frontend_event_logs_error_level,
    path_name TEXT,
    payload TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    created_app_version TEXT NOT NULL,
    created_commit_id TEXT NOT NULL
);

-- インデックス（必要な列に対して）
CREATE INDEX idx_frontend_event_logs_error_level ON frontend_event_logs(error_level);
CREATE INDEX idx_frontend_event_logs_created_at ON frontend_event_logs(created_at);

-- コメント（テーブル）
COMMENT ON TABLE frontend_event_logs IS 'フロントエンドで発生したユーザー操作・画面表示イベントなどを記録するログテーブル';

-- コメント（カラム）
COMMENT ON COLUMN frontend_event_logs.id IS 'フロントログの一意なID';
COMMENT ON COLUMN frontend_event_logs.user_id IS '操作を行ったユーザーのID';
COMMENT ON COLUMN frontend_event_logs.event_name IS 'イベント名（例：onPressPlay, mounted）';
COMMENT ON COLUMN frontend_event_logs.error_level IS 'エラーレベル';
COMMENT ON COLUMN frontend_event_logs.path_name IS 'アクセス時のパス（例：/spot-guide/display）';
COMMENT ON COLUMN frontend_event_logs.payload IS '任意のイベント追加情報（例：{ spot_id: ''abc'' }）';
COMMENT ON COLUMN frontend_event_logs.created_at IS 'イベント発生日時';
COMMENT ON COLUMN frontend_event_logs.created_app_version IS 'イベント発生時のアプリバージョン';
COMMENT ON COLUMN frontend_event_logs.created_commit_id IS '発生時のコードバージョン（Git SHAなど）';


-- RLS 有効化
ALTER TABLE frontend_event_logs ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーのみ INSERT を許可（自分のデータのみ）
CREATE POLICY "Allow insert for authenticated users only"
    ON frontend_event_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- 他操作は許可しない（ポリシー定義なし = 拒否）