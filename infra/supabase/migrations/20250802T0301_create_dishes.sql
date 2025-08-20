CREATE TABLE dishes (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID        NOT NULL REFERENCES restaurants(id),
    category_id   TEXT        NOT NULL REFERENCES dish_categories(id),
    name          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_no       INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX idx_dishes_category ON dishes (category_id);
CREATE INDEX idx_dishes_restaurant ON dishes (restaurant_id);

COMMENT ON TABLE dishes IS '店舗ごとの具体的な料理マスター';
ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;
