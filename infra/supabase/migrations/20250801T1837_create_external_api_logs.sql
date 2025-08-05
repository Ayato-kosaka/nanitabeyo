-- テーブル定義
CREATE TABLE external_api_logs (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    function_name TEXT,
    api_name TEXT,
    endpoint TEXT,
    method TEXT,
    request_payload JSON,
    response_payload JSON,
    status_code SMALLINT,
    error_message TEXT,
    response_time_ms INTEGER,
    user_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    created_commit_id TEXT NOT NULL
);

-- インデックス
CREATE INDEX idx_external_api_logs_request_id ON external_api_logs(request_id);
CREATE INDEX idx_external_api_logs_status_code ON external_api_logs(status_code);
CREATE INDEX idx_external_api_logs_created_at ON external_api_logs(created_at);

-- テーブルコメント
COMMENT ON TABLE external_api_logs IS '外部APIを Cloud Functions から呼び出す際のログ情報を記録するテーブル。主にトラブルシュート／使用状況の可視化／パフォーマンス監視を目的とする。';

-- カラムコメント
COMMENT ON COLUMN external_api_logs.id IS '外部APIログの一意なID（UUID）';
COMMENT ON COLUMN external_api_logs.request_id IS '呼び出し単位のトレースID（ログ間の関連付けに使用）';
COMMENT ON COLUMN external_api_logs.function_name IS '呼び出し元の関数名（例：recognizeSpot）';
COMMENT ON COLUMN external_api_logs.api_name IS '使用した外部APIの名前（例：GoogleVision）';
COMMENT ON COLUMN external_api_logs.endpoint IS 'APIエンドポイント（例：/v1/images:annotate）';
COMMENT ON COLUMN external_api_logs.method IS 'HTTPメソッド（例：GET, POST, PUT, DELETE）';
COMMENT ON COLUMN external_api_logs.request_payload IS 'APIリクエストの内容';
COMMENT ON COLUMN external_api_logs.response_payload IS 'APIレスポンスの内容';
COMMENT ON COLUMN external_api_logs.status_code IS 'HTTPステータスコード（例：200, 500）';
COMMENT ON COLUMN external_api_logs.error_message IS 'エラー発生時のメッセージ（例外を文字列化）';
COMMENT ON COLUMN external_api_logs.response_time_ms IS 'レスポンスまでの所要時間（ミリ秒）';
COMMENT ON COLUMN external_api_logs.user_id IS 'API呼び出し元のユーザーID';
COMMENT ON COLUMN external_api_logs.created_at IS '呼び出し日時';
COMMENT ON COLUMN external_api_logs.created_commit_id IS '呼び出し時のコードバージョン（Git SHAなど）';

-- RLS 有効化
ALTER TABLE external_api_logs ENABLE ROW LEVEL SECURITY;
