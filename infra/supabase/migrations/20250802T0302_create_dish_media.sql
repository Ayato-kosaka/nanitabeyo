CREATE TABLE dish_media (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_id        UUID        NOT NULL REFERENCES dishes(id),
    user_id        UUID        REFERENCES users(id),
    media_path     TEXT        NOT NULL,
    media_type     TEXT        NOT NULL CHECK (media_type IN ('image','video')),
    thumbnail_path TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_no        INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX idx_dish_media_dish ON dish_media (dish_id);

COMMENT ON TABLE dish_media IS 'ユーザ投稿メディア（写真・動画）';
ALTER TABLE dish_media ENABLE ROW LEVEL SECURITY;
