-- ENUM型の定義

-- テーブル定義
CREATE TABLE reactions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_version TEXT NOT NULL,
    lock_no INTEGER NOT NULL
);

-- インデックス
CREATE INDEX idx_reactions_target_id ON reactions(target_id);

-- コメント（テーブル）
COMMENT ON TABLE reactions IS 'ユーザーによるリアクション（例：いいね、やり直しなど）を記録するテーブル';

-- コメント（カラム）
COMMENT ON COLUMN reactions.id IS 'リアクションの一意なID（UUID）';
COMMENT ON COLUMN reactions.user_id IS 'リアクションをしたユーザーのID（匿名可）';
COMMENT ON COLUMN reactions.target_type IS 'リアクション対象のテーブル（例：spot, spot_guide）';
COMMENT ON COLUMN reactions.target_id IS '対象となるスポットやガイドのID';
COMMENT ON COLUMN reactions.action_type IS '実行されたアクションの種類（例：like, bookmark）';
COMMENT ON COLUMN reactions.created_at IS 'リアクション作成日時';
COMMENT ON COLUMN reactions.created_version IS '実行時のアプリバージョン（バグ分析用途）';
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