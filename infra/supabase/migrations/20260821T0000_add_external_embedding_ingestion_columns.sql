-- =============================================================================
-- 20260821T0000_add_external_embedding_ingestion_columns.sql
-- #1273（BigQuery 由来の一括取り込み）/ #1375・#1395 との衝突解消
-- =============================================================================
--
-- 【このファイルが在る理由】
--
-- dish_media_external_embeddings は、かつて 2 本の migration がそれぞれ別の定義で
-- CREATE TABLE IF NOT EXISTS しており、«先に流れた方が勝ち、後は無言でスキップ» という
-- 形で片方の設計が壊れる状態だった（列構成・provider の値域・PK の取り方が食い違っていた）。
--
-- 2026-08-21 に **作成元を 20260819T0200 へ一本化**し、20260823T0000 からは
-- CREATE TABLE を外した。その結果、20260823T0000 が必要としていた «一括取り込み系の列» が
-- 行き場を失うので、このファイルが «作成済みのテーブルへ足す ALTER» として引き受ける。
--
-- ファイル名がテーブル作成（20260819T0200）より後になっているのは**意図的**である。
-- apply-migration.sh は from_file 以降をファイル名昇順で流すので、
-- この順序でなければ «存在しないテーブルを ALTER する» ことになって必ず失敗する。
--
-- 【なぜ全て NULL 許容なのか（元は NOT NULL だった）】
--
-- このテーブルへ書き込む経路は 2 つあり、**片方はこれらの列を持たない**。
--
--   1. #1273 の一括取り込み（BigQuery → PostgreSQL 同期）… これらの列を埋める
--   2. #1399 のユーザー取り込み（SNS の URL を貼る / 共有シート）… **埋めない**
--
-- 2 は oEmbed の HTML を保存しない設計である（#1375 設計の正本 §2 / #1273 §14。
-- HTML を永続的な SoT にすると provider 側の仕様変更に追随できなくなるため、
-- canonical_url から provider 別コンポーネントが都度描画する）。
-- ここを NOT NULL にすると **2 の経路が構造的に INSERT できなくなる**ので、
-- 全て NULL 許容にしてある。「1 の経路では必ず埋める」は書き込み側の責務とする。
--
-- 【⚠️ availability_status と embed_status の関係（要フォロー）】
--
-- 20260819T0200 が作る embed_status（unknown / available / unavailable）と、
-- ここで足す availability_status（available / unavailable / deleted / private / ineligible）は
-- **目的が重なっている**。どちらも「埋め込みがまだ表示できるか」を表す。
--
-- このファイルでは «元の設計を落とさない» ことを優先して両方残すが、
-- **二重管理は将来のバグの温床**である。どちらを SoT にするかは別途決めること。
--   - embed_status … #1273 §39 の死活監視バッチが idx_dmee_status_verified で回す
--   - availability_status … 取り込み時点で判明した詳細な理由まで持てる
-- 統合するなら「availability_status を詳細理由として残し、embed_status を
-- そこから導出する」形が素直だが、死活監視バッチの索引に手が入るため本ファイルでは触らない。
--
-- 【ロールバック】
--   ALTER TABLE dish_media_external_embeddings
--     DROP COLUMN IF EXISTS embed_html,
--     DROP COLUMN IF EXISTS thumbnail_url,
--     DROP COLUMN IF EXISTS availability_status,
--     DROP COLUMN IF EXISTS rights_basis,
--     DROP COLUMN IF EXISTS terms_version,
--     DROP COLUMN IF EXISTS published_at,
--     DROP COLUMN IF EXISTS source_row_hash;
--   DROP INDEX IF EXISTS dish_media_external_availability_idx;
-- =============================================================================

BEGIN;

-- 足す列は «このブランチのコードが実際に読み書きしているもの» を基準にした。
-- api/src/v1/dish-media/dish-media.repository.ts の $queryRaw が SELECT している
-- 列（embed_html / thumbnail_url / availability_status / rights_basis /
-- terms_version / published_at）と、同期スクリプトが書く source_row_hash である。
ALTER TABLE dish_media_external_embeddings
  ADD COLUMN IF NOT EXISTS embed_html          TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url       TEXT,
  ADD COLUMN IF NOT EXISTS availability_status TEXT,
  ADD COLUMN IF NOT EXISTS rights_basis        TEXT,
  ADD COLUMN IF NOT EXISTS terms_version       TEXT,
  ADD COLUMN IF NOT EXISTS published_at        TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS source_row_hash     TEXT;

-- 値域は元の 20260823T0000 の定義を踏襲する。
-- NULL は «この経路では埋めていない» を意味するので CHECK は NULL を通す
-- （SQL の CHECK は NULL を UNKNOWN として通すため、明示的な OR IS NULL は要らないが、
--  読み手が «NULL は許されるのか» で迷わないよう意図をここに書いておく）。
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dish_media_external_availability_check;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dish_media_external_availability_check
  CHECK (availability_status IN ('available', 'unavailable', 'deleted', 'private', 'ineligible'))
  NOT VALID;
ALTER TABLE dish_media_external_embeddings
  VALIDATE CONSTRAINT dish_media_external_availability_check;

-- 元の 20260823T0000 が張っていた索引。取り込みバッチが
-- 「availability_status 別に、古い検証から順に」拾うために使う。
CREATE INDEX IF NOT EXISTS dish_media_external_availability_idx
  ON dish_media_external_embeddings(availability_status, last_verified_at DESC);

COMMENT ON COLUMN dish_media_external_embeddings.embed_html IS
  '公式oEmbed等から得たHTML。API/クライアントでprovider allowlistとCSPを適用して表示する。#1273 の一括取り込み経路のみが埋め、#1399 のユーザー取り込み経路は NULL のままにする（HTML を SoT にしない設計のため）。';
COMMENT ON COLUMN dish_media_external_embeddings.rights_basis IS
  'official_api / official_oembed / partner_license / first_party_permission。#1273 の一括取り込み経路のみが埋める。';
COMMENT ON COLUMN dish_media_external_embeddings.availability_status IS
  '取り込み時点で判明した詳細な可用性（available/unavailable/deleted/private/ineligible）。⚠️ embed_status と目的が重なっている。統合方針は 20260821T0000 のヘッダを参照。';
COMMENT ON COLUMN dish_media_external_embeddings.thumbnail_url IS
  'provider 側のサムネイルURL。#1273 の一括取り込み経路のみが埋める。';
COMMENT ON COLUMN dish_media_external_embeddings.terms_version IS
  '取り込み時に同意した利用規約のバージョン。#1273 の一括取り込み経路のみが埋める。';
COMMENT ON COLUMN dish_media_external_embeddings.published_at IS
  'provider 上での投稿日時。#1273 の一括取り込み経路のみが埋める。';
COMMENT ON COLUMN dish_media_external_embeddings.source_row_hash IS
  'BigQuery publish rowの差分検知hash。#1273 の一括取り込み経路のみが埋める。';

COMMIT;
