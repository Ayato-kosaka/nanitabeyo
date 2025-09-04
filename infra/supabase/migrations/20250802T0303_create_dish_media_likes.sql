-- 20250802T0302_create_dish_media_likes.sql
CREATE TABLE dish_media_likes (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dish_media_id UUID        NOT NULL REFERENCES dish_media(id),
    user_id       UUID        NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dish_media_id, user_id)  -- 二重いいね防止
);

CREATE INDEX idx_dish_media_likes_media ON dish_media_likes (dish_media_id);
CREATE INDEX idx_dish_media_likes_user ON dish_media_likes (user_id);

COMMENT ON TABLE dish_media_likes IS '料理メディアのいいね情報を保存するテーブル';
ALTER TABLE dish_media_likes ENABLE ROW LEVEL SECURITY;
