CREATE EXTENSION IF NOT EXISTS "postgis";

CREATE TABLE restaurants (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    google_place_id TEXT UNIQUE,
    name            TEXT        NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    location        GEOGRAPHY(Point,4326)
        GENERATED ALWAYS AS (
          ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
        ) STORED,
    image_url       TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_restaurants_location ON restaurants USING GIST(location);

COMMENT ON TABLE restaurants IS '実店舗マスター';
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
