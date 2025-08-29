-- Reactions table schema optimization
-- This migration optimizes the reactions table for better performance and data integrity

-- 1. Change id column from TEXT to UUID with default
ALTER TABLE reactions ALTER COLUMN id TYPE UUID USING CASE 
  WHEN id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
  THEN id::UUID 
  ELSE gen_random_uuid() 
END;

ALTER TABLE reactions ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 2. Add default values for created_at and lock_no
ALTER TABLE reactions ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE reactions ALTER COLUMN lock_no SET DEFAULT 1;

-- 3. Add unique constraint to prevent duplicate reactions
ALTER TABLE reactions ADD CONSTRAINT uk_reactions_user_target_action 
  UNIQUE (user_id, target_type, target_id, action_type);

-- 4. Drop existing index (will be replaced with optimized ones)
DROP INDEX IF EXISTS idx_reactions_target_id;

-- 5. Add optimized indexes

-- Profile screen cursor pagination (user's reactions ordered by created_at, id for stability)
CREATE INDEX idx_reactions_profile_cursor
  ON reactions (user_id, target_type, action_type, created_at DESC, id);

-- Aggregation queries (groupBy target_id with target_type and action_type filtering)
CREATE INDEX idx_reactions_agg
  ON reactions (target_type, action_type, target_id);

-- User target_id searches (find user's reactions to specific targets)
CREATE INDEX idx_reactions_user_target_id
  ON reactions (user_id, target_id);

-- 6. Update table and column comments to reflect current domain

-- Table comment
COMMENT ON TABLE reactions IS 'ユーザーのリアクションを記録（例：like, bookmark, hide）';

-- Column comments
COMMENT ON COLUMN reactions.id IS 'リアクションの一意なID（UUID）';
COMMENT ON COLUMN reactions.user_id IS 'リアクションをしたユーザーのID';
COMMENT ON COLUMN reactions.target_type IS 'リアクション対象のテーブル（例：dish_reviews, dish_media）';
COMMENT ON COLUMN reactions.target_id IS '対象となるレビューやメディアのID';
COMMENT ON COLUMN reactions.action_type IS '実行されたアクションの種類（例：like, bookmark, hide）';
COMMENT ON COLUMN reactions.meta IS 'メタ情報を格納するJSONBフィールド（例：hideReason等）';
COMMENT ON COLUMN reactions.created_at IS 'リアクション作成日時（デフォルト：現在時刻）';
COMMENT ON COLUMN reactions.created_version IS '実行時のアプリバージョン（バグ分析用途）';
COMMENT ON COLUMN reactions.lock_no IS '楽観ロック用バージョン番号（デフォルト：1）';

-- RLS policies remain unchanged as they are already correctly configured