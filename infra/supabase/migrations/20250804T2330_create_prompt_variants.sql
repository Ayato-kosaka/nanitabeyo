-- テーブル定義
CREATE TABLE prompt_variants (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    variant_number INTEGER NOT NULL,
    prompt_text TEXT NOT NULL,
    improvement_note TEXT,
    created_by TEXT NOT NULL,
    metadata JSONB,
    
    UNIQUE(family_id, variant_number),
    FOREIGN KEY (family_id) REFERENCES prompt_families(id)
);

-- インデックス
CREATE INDEX idx_prompt_variants_family_id ON prompt_variants(family_id);
CREATE INDEX idx_prompt_variants_variant_number ON prompt_variants(variant_number);

-- テーブルコメント
COMMENT ON TABLE prompt_variants IS 'プロンプトファミリーごとの改善・育成履歴を管理するバリエーションテーブル';

-- カラムコメント
COMMENT ON COLUMN prompt_variants.id IS 'プロンプトバリエーションのID（UUID）';
COMMENT ON COLUMN prompt_variants.family_id IS '紐づくプロンプトファミリーID';
COMMENT ON COLUMN prompt_variants.variant_number IS 'ファミリー内のバージョン番号（1〜）';
COMMENT ON COLUMN prompt_variants.prompt_text IS '実際にLLMに渡すプロンプトテンプレート';
COMMENT ON COLUMN prompt_variants.improvement_note IS '改善ポイントやコメント';
COMMENT ON COLUMN prompt_variants.created_by IS '作成者';
COMMENT ON COLUMN prompt_variants.metadata IS '将来の柔軟性を確保するための拡張フィールド';

-- RLS 有効化
ALTER TABLE prompt_variants ENABLE ROW LEVEL SECURITY;
