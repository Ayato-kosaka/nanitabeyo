CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;

CREATE TABLE dish_category_variants (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_category_id TEXT       NOT NULL REFERENCES dish_categories(id),
    surface_form    TEXT        NOT NULL  CHECK (surface_form = lower(surface_form)),
    source          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (surface_form)  -- 表記揺れは単独一意
);

CREATE INDEX idx_dcv_surface_form_trgm ON dish_category_variants USING GIN (surface_form gin_trgm_ops);
CREATE INDEX idx_dish_category_variants_dish_category_id ON dish_category_variants(dish_category_id);

COMMENT ON TABLE dish_category_variants IS '料理カテゴリ表記揺れ辞書';
ALTER TABLE dish_category_variants ENABLE ROW LEVEL SECURITY;