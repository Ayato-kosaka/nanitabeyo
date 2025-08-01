-- テーブル定義
CREATE TABLE dish_categories (
    id TEXT PRIMARY KEY,
    label_en TEXT NOT NULL,
    labels JSONB NOT NULL,
    image_url TEXT NOT NULL,
    origin TEXT[],
    cuisine TEXT[],
    tags TEXT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    lock_no INTEGER NOT NULL
);

-- インデックス
CREATE INDEX idx_dish_categories_tags ON dish_categories USING GIN(tags);

-- コメント（テーブル）
COMMENT ON TABLE dish_categories IS '料理カテゴリーマスター（多言語・分類タグなどを含む）';

-- コメント（カラム）
COMMENT ON COLUMN dish_categories.id IS 'Wikidata QID などの一意なID（例：Q1338822）';
COMMENT ON COLUMN dish_categories.label_en IS '英語の正規表記名（例：Samgyeopsal）';
COMMENT ON COLUMN dish_categories.labels IS '多言語ラベル（{ "ja": "サムギョプサル", "ko": "삼겹살" }）';
COMMENT ON COLUMN dish_categories.image_url IS 'P18 (画像) 由来のURL';
COMMENT ON COLUMN dish_categories.origin IS '原産国QID（例：["Q884"] for South Korea）';
COMMENT ON COLUMN dish_categories.cuisine IS 'cuisineに関係するQID（例：["Q647500"]）';
COMMENT ON COLUMN dish_categories.tags IS '再帰的に得られた上位カテゴリのQID群（木登り結果）';
COMMENT ON COLUMN dish_categories.created_at IS '作成日時';
COMMENT ON COLUMN dish_categories.updated_at IS '更新日時';
COMMENT ON COLUMN dish_categories.lock_no IS '楽観ロック用のバージョン番号';

-- RLS 有効化
ALTER TABLE ext_spots ENABLE ROW LEVEL SECURITY;