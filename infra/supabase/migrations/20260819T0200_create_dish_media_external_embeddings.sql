-- ==============================================================================
-- 20260819T0200_create_dish_media_external_embeddings.sql
-- #1395（親 #1375 / #1273 §14・§39 準拠）
-- ==============================================================================
-- 【目的】
--   render_type='external_embed' の dish_media が指す「SNS 側の投稿」を保持する。
--   dish_media と 1:1（dish_media_analysis_results と同じく PK = 参照先 ID）。
--
-- 【設計上の判断】
--   - oEmbed が返す HTML の列は置かない（#1375 設計の正本 §2 / #1273 §14）。
--     HTML を永続的な SoT にすると provider 側の仕様変更に追随できなくなるため、
--     canonical_url から provider 別コンポーネントが都度描画する。
--   - (provider, external_content_id) を自然キーとして UNIQUE にし、
--     同じ投稿を二重に取り込まないようにする。
--   - embed_status / last_verified_at は #1273 §39 の「埋め込み死活監視」バッチが
--     「古い順に再検証」するために使う。
--   - 対象 provider は **TikTok / YouTube Shorts / Instagram の 3 つ**（#1395 仕様追補）。
--     X・threads は対象外なので CHECK で構造的に弾く。
--
-- 【ロールバック】
--   DROP TABLE IF EXISTS dish_media_external_embeddings;
-- ==============================================================================

-- 依存拡張（gen_random_uuid は使わないが、近隣ファイルと同じく明示しておく）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS dish_media_external_embeddings (
  -- dish_media と 1:1。dish_media_analysis_results（20251025T0201）と同じく PK = 参照先 ID
  dish_media_id       uuid PRIMARY KEY
                      REFERENCES dish_media(id) ON DELETE CASCADE,

  provider            text NOT NULL,
  external_content_id text NOT NULL,
  canonical_url       text NOT NULL,
  embed_status        text NOT NULL DEFAULT 'unknown',
  last_verified_at    timestamptz(6) NULL,

  -- 監査
  created_at          timestamptz(6) NOT NULL DEFAULT now(),
  updated_at          timestamptz(6) NOT NULL DEFAULT now(),

  -- #1395 仕様追補: 対象 provider は TikTok / YouTube Shorts / Instagram の 3 つ。
  -- ⚠️ この CHECK は CREATE TABLE IF NOT EXISTS のインライン制約なので、
  --    既にテーブルがある環境には**反映されない**。ファイル末尾の
  --    「provider を 3 つへ揃え直す」ブロックが実体を保証する。
  CONSTRAINT dmee_provider_check
    CHECK (provider IN ('instagram','tiktok','youtube')),
  CONSTRAINT dmee_embed_status_check
    CHECK (embed_status IN ('unknown','available','unavailable')),
  -- 同じ投稿を二重に取り込まないための自然キー
  CONSTRAINT dmee_provider_content_uq UNIQUE (provider, external_content_id)
);

-- 埋め込み死活監視（#1273 §39）のバッチが「古い順に再検証」するための索引
CREATE INDEX IF NOT EXISTS idx_dmee_status_verified
  ON dish_media_external_embeddings (embed_status, last_verified_at);

-- コメント（テーブル）
COMMENT ON TABLE dish_media_external_embeddings IS 'SNS の公式埋め込みで描画する dish_media の外部投稿情報。dish_media と 1:1（render_type=''external_embed'' の行のみが持つ）。oEmbed が返す HTML は保持しない。#1395 / #1273';

-- コメント（カラム）
COMMENT ON COLUMN dish_media_external_embeddings.dish_media_id IS 'dish_media の主キーを参照（削除時 CASCADE）';
COMMENT ON COLUMN dish_media_external_embeddings.provider IS '埋め込み元 SNS（instagram / tiktok / youtube）。provider 別の埋め込みコンポーネントを選ぶのに使う。#1395 の仕様追補で X・threads は対象外に確定';
COMMENT ON COLUMN dish_media_external_embeddings.external_content_id IS 'provider 側の投稿ID（ツイートID・動画IDなど）。(provider, external_content_id) で一意';
COMMENT ON COLUMN dish_media_external_embeddings.canonical_url IS 'provider 上の正規URL。埋め込み描画とリンク遷移の SoT';
COMMENT ON COLUMN dish_media_external_embeddings.embed_status IS '埋め込みの死活（unknown=未検証 / available=表示可 / unavailable=削除・非公開等で表示不可）';
COMMENT ON COLUMN dish_media_external_embeddings.last_verified_at IS '最後に死活検証した日時。NULL は未検証。idx_dmee_status_verified で古い順に再検証する';
COMMENT ON COLUMN dish_media_external_embeddings.created_at IS 'レコード作成日時';
COMMENT ON COLUMN dish_media_external_embeddings.updated_at IS 'レコード更新日時（トリガで自動更新）';

-- updated_at 自動更新トリガ（20251025T0201:49-62 の作法）
-- DEFAULT now() は INSERT にしか効かないため、死活監視バッチの UPDATE では
-- このトリガが無いと updated_at が古いまま残る
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_updated_at_on_dmee ON dish_media_external_embeddings;
CREATE TRIGGER set_updated_at_on_dmee
BEFORE UPDATE ON dish_media_external_embeddings
FOR EACH ROW
EXECUTE FUNCTION trg_set_updated_at();

-- RLS 有効化
--
-- ⚠️ ポリシーは意図的に 1 つも定義しない = 全てのクライアントロールからのアクセスを拒否する。
--    このテーブルを読み書きするのは API サーバ（Prisma 接続ロール = テーブル所有者）と
--    埋め込み死活監視バッチだけであり、どちらも RLS をバイパスする。
--    dish_media_analysis_results（20251025T0201）も同じ扱いである。
--    クライアント（supabase-js の anon / authenticated）から直接読む必要が出た場合に限り、
--    そのとき必要な範囲のポリシーを追加すること。
ALTER TABLE dish_media_external_embeddings ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------
-- provider を 3 つ（instagram / tiktok / youtube）へ揃え直す
--
-- ⚠️ **上の CREATE TABLE は IF NOT EXISTS なので、既にテーブルがある環境では
--    丸ごとスキップされ、インライン CHECK の書き換えは一切反映されない。**
--    scripts/apply-migration.sh は from_file 以降を毎回全部流すため、
--    「テーブルが既にある環境」は普通に起こりうる。
--    よって CHECK の実体は DROP → ADD で張り直す（20260819T0100 の m-2 と同じ作法。
--    ADD CONSTRAINT に IF NOT EXISTS は無いので DROP CONSTRAINT IF EXISTS を必ず前に置く）。
--    NOT VALID で即時に張ってから VALIDATE する（VALIDATE は弱いロックで済む）。
-- ------------------------------------------------------------------
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_provider_check;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_provider_check
  CHECK (provider IN ('instagram','tiktok','youtube')) NOT VALID;
ALTER TABLE dish_media_external_embeddings VALIDATE CONSTRAINT dmee_provider_check;
