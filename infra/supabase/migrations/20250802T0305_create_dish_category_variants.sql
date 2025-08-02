-- テーブル定義
CREATE TABLE dish_category_variants (
    id TEXT PRIMARY KEY,
    dish_category_id TEXT NOT NULL REFERENCES dish_categories(id),
    surface_form TEXT NOT NULL,
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    lock_no INTEGER NOT NULL
);

-- インデックス
CREATE INDEX dish_category_variants_surface_trgm_idx ON dish_category_variants USING gin (surface_form gin_trgm_ops);
CREATE INDEX idx_dish_category_variants_dish_category_id ON dish_category_variants(dish_category_id);

-- コメント（テーブル）
COMMENT ON TABLE dish_category_variants IS '料理カテゴリーマスターに対する表記ゆれ（ひらがな・カタカナ・ローマ字・俗称など）';

-- コメント（カラム）
COMMENT ON COLUMN dish_category_variants.id IS '一意なID';
COMMENT ON COLUMN dish_category_variants.dish_category_id IS '紐づく料理カテゴリのQID';
COMMENT ON COLUMN dish_category_variants.surface_form IS '表記ゆれ文字列（例："gyudon", "ぎゅうどん"）';
COMMENT ON COLUMN dish_category_variants.source IS '登録元情報（例："wikidata-label", "katakana-gen"）';
COMMENT ON COLUMN dish_category_variants.created_at IS '作成日時';
COMMENT ON COLUMN dish_category_variants.lock_no IS '楽観ロック用のバージョン番号';

-- RLS 有効化
ALTER TABLE dish_category_variants ENABLE ROW LEVEL SECURITY;