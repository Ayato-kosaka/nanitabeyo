-- ==============================================================================
-- 20260623T0000_create_dish_category_group_votes.sql
-- #856
-- ==============================================================================
-- 【目的】
-- dish_category を候補としたグループ投票セッションを保存する。
--
-- 【背景】
-- 「なに食べよ」の候補料理を友人と共有し、各参加者が一発勝負で
-- like / dislike を入力できるようにする。
-- 候補の表示名・画像・店舗提案用 dish_media_ids は、投票開始時点の
-- スナップショットとして固定する。
--
-- 【実装方針】
-- - 汎用投票テーブルにはせず、dish_category group vote 専用にする
-- - host_user_id / participant user_id は Supabase Auth の user id を保存する
--   （匿名ユーザーもあり、public.users 行が必ず存在する前提ではないため FK は張らない）
-- - 共有URLには share_token を使い、DB主キー id は公開URLに載せない
-- - 候補削除は投票後も可能にするため、deleted_at による論理削除にする
-- - votes は insert-only。投票変更・削除はしない
-- - Realtime は participants INSERT を session_id filter 付きで購読し、
--   受信後に API の detail を再取得する前提
-- ==============================================================================

-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: dish_category_group_vote_sessions
-- =========================

CREATE TABLE IF NOT EXISTS dish_category_group_vote_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id  uuid NOT NULL,
  share_token   text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Table: dish_category_group_vote_candidates
-- =========================

CREATE TABLE IF NOT EXISTS dish_category_group_vote_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES dish_category_group_vote_sessions(id) ON DELETE CASCADE,
  dish_category_id text NOT NULL REFERENCES dish_categories(id),
  display_name     text NOT NULL,
  image_url        text NOT NULL,
  dish_media_ids   uuid[] NOT NULL DEFAULT '{}'::uuid[],
  display_order    integer NOT NULL,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (session_id, dish_category_id),
  UNIQUE (session_id, display_order)
);

-- =========================
-- Table: dish_category_group_vote_participants
-- =========================

CREATE TABLE IF NOT EXISTS dish_category_group_vote_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES dish_category_group_vote_sessions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  display_name  text NOT NULL,
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (session_id, user_id)
);

-- =========================
-- Table: dish_category_group_vote_candidate_votes
-- =========================

CREATE TABLE IF NOT EXISTS dish_category_group_vote_candidate_votes (
  participant_id uuid NOT NULL REFERENCES dish_category_group_vote_participants(id) ON DELETE CASCADE,
  candidate_id   uuid NOT NULL REFERENCES dish_category_group_vote_candidates(id) ON DELETE CASCADE,
  reaction       text NOT NULL CHECK (reaction IN ('like', 'dislike')),
  created_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (participant_id, candidate_id)
);

-- =========================
-- インデックス
-- =========================

CREATE INDEX IF NOT EXISTS idx_dcgvs_share_token
  ON dish_category_group_vote_sessions (share_token);

CREATE INDEX IF NOT EXISTS idx_dcgv_candidates_session
  ON dish_category_group_vote_candidates (session_id, display_order);

CREATE INDEX IF NOT EXISTS idx_dcgv_candidates_category
  ON dish_category_group_vote_candidates (dish_category_id);

CREATE INDEX IF NOT EXISTS idx_dcgv_candidates_active
  ON dish_category_group_vote_candidates (session_id, display_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dcgv_participants_session
  ON dish_category_group_vote_participants (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_dcgv_votes_candidate
  ON dish_category_group_vote_candidate_votes (candidate_id);

-- =========================
-- テーブルコメント
-- =========================

COMMENT ON TABLE dish_category_group_vote_sessions IS
  'dish_category 候補のグループ投票セッション。共有URL用 share_token とホストユーザーIDを保持する。';

COMMENT ON COLUMN dish_category_group_vote_sessions.id IS
  'グループ投票セッションID（UUID）。内部参照用で、公開URLには share_token を使う。';

COMMENT ON COLUMN dish_category_group_vote_sessions.host_user_id IS
  'セッション作成者の Supabase Auth user id。匿名ユーザーもあり public.users FK は張らない。';

COMMENT ON COLUMN dish_category_group_vote_sessions.share_token IS
  '共有URLに載せる推測困難な公開トークン。';

COMMENT ON COLUMN dish_category_group_vote_sessions.updated_at IS
  '投票追加・候補削除など、セッション配下の変化を示す更新日時。';

COMMENT ON TABLE dish_category_group_vote_candidates IS
  'グループ投票に固定された dish_category 候補。表示名・画像・店舗提案用 dish_media_ids は作成時点のスナップショット。';

COMMENT ON COLUMN dish_category_group_vote_candidates.dish_category_id IS
  '投票対象の dish_categories.id。';

COMMENT ON COLUMN dish_category_group_vote_candidates.display_name IS
  '投票作成時点で固定された候補表示名。';

COMMENT ON COLUMN dish_category_group_vote_candidates.image_url IS
  '投票作成時点で固定された候補画像URL。';

COMMENT ON COLUMN dish_category_group_vote_candidates.dish_media_ids IS
  '店舗提案画面に遷移するための dish_media.id 配列。候補作成時点で最大5件を固定する。';

COMMENT ON COLUMN dish_category_group_vote_candidates.display_order IS
  '結果画面・投票画面で使う固定表示順。ランキングで並び替えない。';

COMMENT ON COLUMN dish_category_group_vote_candidates.deleted_at IS
  'ホストによる候補削除日時。投票後削除も可能にするため論理削除にする。';

COMMENT ON TABLE dish_category_group_vote_participants IS
  'グループ投票の参加者。1セッションにつき1ユーザー1参加で、表示名と任意コメントを保持する。';

COMMENT ON COLUMN dish_category_group_vote_participants.user_id IS
  '参加者の Supabase Auth user id。匿名ユーザーもあり public.users FK は張らない。';

COMMENT ON COLUMN dish_category_group_vote_participants.display_name IS
  '結果画面に表示する参加者名。文字数制限はAPI/UIで検証する。';

COMMENT ON COLUMN dish_category_group_vote_participants.comment IS
  '参加者ごとの任意コメント。料理ごとではなく参加者ごとに1件。';

COMMENT ON TABLE dish_category_group_vote_candidate_votes IS
  '参加者ごとの候補別投票。like / dislike のみを保存し、投票後の変更は行わない。';

COMMENT ON COLUMN dish_category_group_vote_candidate_votes.reaction IS
  '候補への反応。like または dislike。';

-- =========================
-- RLS（有効化のみ。通常の読み書きは API 経由）
-- =========================

ALTER TABLE dish_category_group_vote_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_category_group_vote_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_category_group_vote_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_category_group_vote_candidate_votes ENABLE ROW LEVEL SECURITY;

-- =========================
-- Realtime
-- =========================
-- MVPでは participants の INSERT だけを Realtime の変更通知として使う。
-- クライアントは session_id=eq.<session_id> filter で購読し、通知を受けたら
-- API の GET detail を再取得して candidates / participants / votes を同期する。
ALTER PUBLICATION supabase_realtime
  ADD TABLE dish_category_group_vote_participants;
