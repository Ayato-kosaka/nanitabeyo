-- Add meta JSONB column to reactions table for storing additional metadata like hideReason

ALTER TABLE reactions ADD COLUMN meta JSONB;

-- Add comment for the new column
COMMENT ON COLUMN reactions.meta IS 'メタ情報を格納するJSONBフィールド（例：hideReason等）';