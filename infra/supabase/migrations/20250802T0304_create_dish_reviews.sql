CREATE TABLE dish_reviews (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_id     UUID        NOT NULL REFERENCES dishes(id),
    comment     TEXT        NOT NULL,
    comment_tsv TSVECTOR    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(comment,''))) STORED,
    original_language_code CHAR(2) NOT NULL,
    user_id     UUID        REFERENCES users(id),
    rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    price_cents INTEGER     CHECK (price_cents > 0),
    currency_code CHAR(3),
    -- レビュー作成時に投稿したメディア。メディアに対するレビューではないため、referencesは貼らない
    created_dish_media_id UUID NOT NULL,
    imported_user_name   TEXT,
    imported_user_avatar TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dish_reviews_fulltext ON dish_reviews USING GIN (comment_tsv);
CREATE INDEX idx_dish_reviews_dish      ON dish_reviews (dish_id);
CREATE INDEX idx_dish_reviews_created_at    ON dish_reviews (created_at);

COMMENT ON TABLE dish_reviews IS '料理レビュー';
ALTER TABLE dish_reviews ENABLE ROW LEVEL SECURITY;
