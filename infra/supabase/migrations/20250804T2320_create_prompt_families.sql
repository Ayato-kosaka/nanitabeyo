-- ENUM型定義（プロンプトの目的種別）
CREATE TYPE prompt_families_purpose AS ENUM (
    'spot_guide_manuscript'
);

-- テーブル定義
CREATE TABLE prompt_families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    purpose prompt_families_purpose NOT NULL,
    weight INTEGER NOT NULL
);

-- インデックス
CREATE INDEX idx_prompt_families_weight ON prompt_families(weight);

-- テーブルコメント
COMMENT ON TABLE prompt_families IS 'プロンプト育成における思想・トーン・目的ごとのファミリー定義を管理するテーブル';

-- カラムコメント
COMMENT ON COLUMN prompt_families.id IS 'プロンプトファミリーの一意なID（UUID）';
COMMENT ON COLUMN prompt_families.name IS 'プロンプトファミリー名（例: friendly_guide）';
COMMENT ON COLUMN prompt_families.description IS '説明メモ（開発者/編集者向け）';
COMMENT ON COLUMN prompt_families.purpose IS 'プロンプトの目的種別';
COMMENT ON COLUMN prompt_families.weight IS '利用優先度（0なら非アクティブ扱い）';

-- RLS 有効化
ALTER TABLE prompt_families ENABLE ROW LEVEL SECURITY;
