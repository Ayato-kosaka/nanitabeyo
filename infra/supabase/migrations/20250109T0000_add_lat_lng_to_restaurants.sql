-- Add lat and lng columns to restaurants table
-- This provides easier access to coordinates via Prisma while keeping the PostGIS location field for advanced operations

ALTER TABLE restaurants
ADD COLUMN lat DOUBLE PRECISION,
ADD COLUMN lng DOUBLE PRECISION;

-- Add index for lat/lng columns for efficient queries
CREATE INDEX idx_restaurants_lat_lng ON restaurants (lat, lng);

-- Update existing records to populate lat/lng from location Point
UPDATE restaurants 
SET lat = ST_Y(location::geometry), 
    lng = ST_X(location::geometry)
WHERE location IS NOT NULL;

-- Add comment for new columns
COMMENT ON COLUMN restaurants.lat IS '緯度 (Latitude) - Prisma用の個別カラム';
COMMENT ON COLUMN restaurants.lng IS '経度 (Longitude) - Prisma用の個別カラム';