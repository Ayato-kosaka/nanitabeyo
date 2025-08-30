-- ENUM型の定義

-- テーブル定義
CREATE TABLE reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    created_version TEXT NOT NULL,
    lock_no INTEGER NOT NULL,
    UNIQUE (user_id, target_type, target_id, action_type)
);

-- インデックス
CREATE INDEX idx_reactions_profile_cursor
  ON reactions (user_id, target_type, action_type, created_at DESC, id);

CREATE INDEX idx_reactions_agg
  ON reactions (target_type, action_type, target_id);

CREATE INDEX idx_reactions_user_target_id
  ON reactions (user_id, target_id);

-- コメント（テーブル）
COMMENT ON TABLE reactions IS 'ユーザーのリアクションを記録（例：like, bookmark, hide）';

-- コメント（カラム）
COMMENT ON COLUMN reactions.id IS 'リアクションID';
COMMENT ON COLUMN reactions.user_id IS 'リアクションしたユーザーのID';
COMMENT ON COLUMN reactions.target_type IS 'リアクション対象の種類（例：dish_reviews, dish_media）';
COMMENT ON COLUMN reactions.target_id IS 'リアクション対象のID';
COMMENT ON COLUMN reactions.action_type IS 'リアクションの種類（例：like, bookmark, hide）';
COMMENT ON COLUMN reactions.meta IS '追加情報（例：hideReason など）';
COMMENT ON COLUMN reactions.created_at IS 'リアクション作成日時';
COMMENT ON COLUMN reactions.created_version IS 'アプリバージョン';
COMMENT ON COLUMN reactions.lock_no IS '楽観ロック用バージョン番号';

-- RLS 有効化
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーのみ INSERT を許可（自分のデータのみ）
CREATE POLICY "Authenticated users can insert their own reactions"
    ON reactions
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- 認証ユーザーのみ DELETE を許可（自分のデータのみ）
CREATE POLICY "Authenticated users can delete their own reactions"
    ON reactions
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- 認証ユーザーのみ SELECT を許可（自分のデータのみ）
CREATE POLICY "Authenticated users can get their own reactions"
    ON reactions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- 他操作は許可しない（ポリシー定義なし = 拒否）
