CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA extensions;

CREATE TABLE restaurants (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    google_place_id     TEXT UNIQUE NOT NULL,
    name                TEXT        NOT NULL,
    name_language_code  TEXT        NOT NULL,
    latitude            DOUBLE PRECISION NOT NULL,
    longitude           DOUBLE PRECISION NOT NULL,
    location            GEOGRAPHY(Point,4326)
        GENERATED ALWAYS AS (
          ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
        ) STORED,
    image_url           TEXT        NOT NULL,
    address_components  JSONB        NOT NULL,  -- Google Place Details の address_components を保存
    plus_code           JSONB        NOT NULL,  -- Google Place Details の plus_code を保存
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 位置情報検索用インデックス
CREATE INDEX idx_restaurants_location ON restaurants USING GIST(location);

COMMENT ON TABLE restaurants IS '実店舗マスター';

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
