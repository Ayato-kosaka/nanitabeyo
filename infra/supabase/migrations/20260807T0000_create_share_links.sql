-- ==============================================================================
-- 20260807T0000_create_share_links.sql
-- #721
-- ==============================================================================
-- 【目的】
-- 共有リンク `/s/:token` の解決情報と、共有カード（OGP）の snapshot を保存する。
--
-- 【背景】
-- Web は `output: "static"` のため `/{locale}/posts?ids=...` の初回 HTML を
-- 投稿ごとに変えられず、SNS の共有カードに投稿固有のタイトル・サムネイルを出せない。
-- 動的 OGP が必要な共有 URL だけ Cloud Run で HTML を生成する。
--
-- 【実装方針】
-- - 対象の指し方は既存 3 テーブル（reactions / contribution_tasks / prompt_usages）に揃え、
--   target_type は「対象テーブル名」、主たる対象は target_id、type 固有の追加情報だけ
--   target_params(jsonb) に置く。share_link_items のような関連テーブルは作らない
-- - OGP は「共有した時点の言語」で固定する。SNS は URL 単位で OGP をキャッシュするため、
--   同じ URL が閲覧者ごとに別の OGP を返す設計は成立しない
-- - preview の画像は **署名 URL ではなく GCS パス**を保存する（後述）
-- ==============================================================================

-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: share_links
-- =========================

CREATE TABLE IF NOT EXISTS share_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- sha256(token)。生トークンは保存しない（DB が漏れてもリンクを復元できないように）
  token_digest   bytea NOT NULL UNIQUE,

  -- target_params / preview の解釈バージョン。増やしても古いリンクを壊さないための番号
  schema_version smallint NOT NULL DEFAULT 1,

  -- 対象テーブル名。値は shared/api/v1/constants/shareLinks.ts の
  -- SHARE_LINK_TARGET_TYPES と **同じ集合**でなければならない
  target_type    text NOT NULL
    CHECK (target_type IN ('dish_media', 'dish_category_group_vote_sessions')),

  -- 主たる対象の ID。dish_media なら OGP に使う先頭の dish_media.id、
  -- 友達投票なら dish_category_group_vote_sessions.id。
  -- 対象テーブルが target_type によって変わるので FK は張らない（既存 3 テーブルと同じ方針）
  target_id      text NOT NULL,

  -- type 固有の追加情報のみ。dish_media の残り ID、友達投票の shareToken など
  target_params  jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 共有した時点の OGP snapshot
  preview_locale      text NOT NULL,
  preview_title       text NOT NULL,
  preview_description text NOT NULL,
  -- ⚠️ **署名付き URL を保存しないこと。** このアプリのメディア URL は既定 24 時間で失効するため
  -- （api/src/core/storage/storage.service.ts）、URL を snapshot すると翌日に OGP 画像が 403 になる。
  -- SNS はキャッシュ期限が切れると再クロールするので「共有直後は出るのに後で消える」形で壊れる。
  --
  -- 受け付ける形は 3 つ（判定は api/src/share/share-image.ts の 1 箇所だけ）:
  --   1. `https://...` / `http://...` … 外部の絶対 URL。そのまま使う（投票候補の Wikimedia 画像など）
  --   2. `/og/ja-JP.jpg` のような `/` 始まり … Web 側の静的アセット。WEB_BASE_URL を前置する
  --   3. それ以外 … GCS のオブジェクトパス。`GET /s/:token/og-image` が毎回署名し直して 302 する
  preview_image_path  text NOT NULL,

  -- ⚠️ **`REFERENCES users(id)` を付けないこと。**
  -- このアプリのユーザーは Supabase Auth の匿名サインインで始まり、**匿名ユーザーには
  -- `users` 行が存在しない**。FK を張ると匿名ユーザーからの共有が必ず失敗する
  -- （api-development で実測: `Foreign key constraint violated on the constraint:
  --  share_links_created_by_fkey` で 500）。
  --
  -- dish_media / dish_reviews などが `users(id)` へ FK を張っているのは、
  -- 「ログイン済みユーザーしか行を作れない」列だから。ここは匿名でも作れるので違う。
  -- 友達投票（20260623T0000）も同じ理由で FK を外している。
  created_by     uuid NULL,

  status         text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),

  expires_at     timestamptz NULL,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- インデックス
-- =========================

-- token_digest は UNIQUE 制約が索引を張るので追加不要。
-- 「この投稿の共有リンク一覧」を引くための索引（target_id を列に出した効用）
CREATE INDEX IF NOT EXISTS idx_share_links_target
  ON share_links (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_share_links_created_by_created_at
  ON share_links (created_by, created_at DESC);

-- =========================
-- テーブルコメント
-- =========================

COMMENT ON TABLE share_links IS
  '共有リンク /s/:token の解決情報と、共有時点の OGP スナップショットを保持するテーブル。SNS クローラ向けに Cloud Run が SSR する。';

COMMENT ON COLUMN share_links.id IS
  '共有リンクの一意な識別子（UUID）。公開 URL には出さない';

COMMENT ON COLUMN share_links.token_digest IS
  '共有トークンの sha256。生トークンは保存しない。server secret は使わない（ローテーションで過去の共有リンクが全滅するため）';

COMMENT ON COLUMN share_links.schema_version IS
  'target_params と preview の解釈バージョン。形を変えたいときに古いリンクを壊さず並行運用するための番号';

COMMENT ON COLUMN share_links.target_type IS
  '共有対象の種別。値は対象テーブル名（例: dish_media, dish_category_group_vote_sessions）。shared/api/v1/constants/shareLinks.ts と同じ集合を保つこと';

COMMENT ON COLUMN share_links.target_id IS
  '主たる共有対象のID。target_type で示したテーブルの主キー。対象テーブルが可変のため外部キー制約は張らない';

COMMENT ON COLUMN share_links.target_params IS
  'target_type ごとの追加情報。dish_media の複数ID、友達投票の share_token など。任意の URL や path は保存しない';

COMMENT ON COLUMN share_links.preview_locale IS
  '共有カードの言語。共有した時点で固定し、閲覧者の言語では変えない（SNS は URL 単位で OGP をキャッシュするため）';

COMMENT ON COLUMN share_links.preview_title IS
  'OGP のタイトル。サーバ側 Resolver が生成する（クライアントから任意の文字列を保存させない）';

COMMENT ON COLUMN share_links.preview_description IS
  'OGP の description。サーバ側 Resolver が生成する';

COMMENT ON COLUMN share_links.preview_image_path IS
  'OGP 画像の GCS パス。署名付き URL ではない（既定24時間で失効し、SNS の再クロール時に 403 になるため）。配信は /s/:token/og-image が毎回署名し直して 302 する';

COMMENT ON COLUMN share_links.created_by IS
  '共有リンクを作成したユーザー。匿名ユーザーからの作成も許すため NULL 可';

COMMENT ON COLUMN share_links.status IS
  'active / revoked。revoked は新規アクセスを 404 にするが、SNS 側に残ったカードのキャッシュまでは消せない';

COMMENT ON COLUMN share_links.expires_at IS
  '有効期限。NULL は無期限。期限切れは revoked と同じく 404 として扱う';

COMMENT ON COLUMN share_links.created_at IS
  '共有リンクの作成日時';

COMMENT ON COLUMN share_links.updated_at IS
  '共有リンクの更新日時（revoke など）';

-- RLS 有効化（他テーブルと同様、アクセスは API 経由に限定する）
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
