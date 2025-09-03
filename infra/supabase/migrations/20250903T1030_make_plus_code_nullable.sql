-- Make plus_code column nullable in restaurants table
-- This allows restaurants without plus_code data from Google Places API to be imported

ALTER TABLE restaurants ALTER COLUMN plus_code DROP NOT NULL;

COMMENT ON COLUMN restaurants.plus_code IS 'Google Place Details の plus_code を保存（任意フィールド）';