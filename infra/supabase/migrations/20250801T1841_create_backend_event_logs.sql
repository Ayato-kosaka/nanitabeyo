-- ENUM型の定義（テーブルに合わせて一意な名前）
CREATE TYPE backend_event_logs_error_level AS ENUM ('trace', 'debug', 'info', 'warn', 'error');

-- テーブル定義
CREATE TABLE backend_event_logs (
    id TEXT PRIMARY KEY,
    event_name TEXT,
    error_level backend_event_logs_error_level,
    function_name TEXT,
    user_id UUID,
    payload JSON,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    created_commit_id TEXT NOT NULL
);

-- インデックス（用途に応じて）
CREATE INDEX idx_backend_event_logs_error_level ON backend_event_logs(error_level);
CREATE INDEX idx_backend_event_logs_created_at ON backend_event_logs(created_at);
CREATE INDEX idx_backend_event_logs_request_id ON backend_event_logs(request_id);

-- テーブルコメント
COMMENT ON TABLE backend_event_logs IS 'Cloud Functions 側での「アクションログ」や「内部イベントログ」を保存';

-- カラムコメント
COMMENT ON COLUMN backend_event_logs.id IS 'バックエンドログの一意なID（UUID）';
COMMENT ON COLUMN backend_event_logs.event_name IS 'イベント名（例：guide_rendered, cache_cleared）';
COMMENT ON COLUMN backend_event_logs.error_level IS 'エラーレベル';
COMMENT ON COLUMN backend_event_logs.function_name IS '実行された関数名（Cloud Function名など）';
COMMENT ON COLUMN backend_event_logs.user_id IS '操作を行ったユーザーID（匿名含む）';
COMMENT ON COLUMN backend_event_logs.payload IS 'イベントに付随する情報';
COMMENT ON COLUMN backend_event_logs.request_id IS '外部APIとの紐づけに使うトレースID';
COMMENT ON COLUMN backend_event_logs.created_at IS 'イベント発生日時';
COMMENT ON COLUMN backend_event_logs.created_commit_id IS '実行時のコードバージョン（Git SHA）';

-- RLS 有効化
ALTER TABLE backend_event_logs ENABLE ROW LEVEL SECURITY;
