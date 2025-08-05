-- ENUM型定義（生成対象のモデル種別）

-- テーブル定義
CREATE TABLE prompt_usages (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    generated_text TEXT NOT NULL,
    used_prompt_text TEXT NOT NULL,
    input_data JSONB,
    llm_model TEXT NOT NULL,
    temperature NUMERIC(3,2),
    generated_user UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_request_id TEXT NOT NULL,
    metadata JSONB
);

-- インデックス
CREATE INDEX idx_prompt_usages_family_id ON prompt_usages(family_id);
CREATE INDEX idx_prompt_usages_variant_id ON prompt_usages(variant_id);
CREATE INDEX idx_prompt_usages_target_type ON prompt_usages(target_type);
CREATE INDEX idx_prompt_usages_target_id ON prompt_usages(target_id);

-- テーブルコメント
COMMENT ON TABLE prompt_usages IS 'プロンプトファミリー・バリエーションによる実際の生成結果と使用ログを記録するテーブル';

-- カラムコメント
COMMENT ON COLUMN prompt_usages.id IS '利用ログの一意なID（UUID）';
COMMENT ON COLUMN prompt_usages.family_id IS '使用されたプロンプトファミリーID';
COMMENT ON COLUMN prompt_usages.variant_id IS '使用されたプロンプトバリエーションID';
COMMENT ON COLUMN prompt_usages.target_type IS '生成対象のモデル種別（例：Postなど）';
COMMENT ON COLUMN prompt_usages.target_id IS '対象レコードのID';
COMMENT ON COLUMN prompt_usages.generated_text IS '実際に生成されたガイド原稿';
COMMENT ON COLUMN prompt_usages.used_prompt_text IS '使用されたプロンプトテンプレートのスナップショット';
COMMENT ON COLUMN prompt_usages.input_data IS '入力値（例：スポット名、ジャンルなど）';
COMMENT ON COLUMN prompt_usages.llm_model IS '使用したLLM（例：claude-3, gpt-4 など）';
COMMENT ON COLUMN prompt_usages.temperature IS 'LLM生成時のtemperature設定';
COMMENT ON COLUMN prompt_usages.generated_user IS '生成実行者（デフォルト生成ガイドの場合は usr_id_for_system）';
COMMENT ON COLUMN prompt_usages.created_at IS '作成日時';
COMMENT ON COLUMN prompt_usages.created_request_id IS '作成した処理単位のトレースID';
COMMENT ON COLUMN prompt_usages.metadata IS '将来のA/Bテスト用メタ情報など';

-- RLS 有効化
ALTER TABLE prompt_usages ENABLE ROW LEVEL SECURITY;
