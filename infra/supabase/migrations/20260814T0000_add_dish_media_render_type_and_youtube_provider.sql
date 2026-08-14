-- =============================================================================
-- #1273 SNS由来 dish_media を表示可能にするための最小スキーマ変更
-- =============================================================================
--
-- 【背景】
-- #1273 の①（無料での dish_media 発見）で確立した手法は YouTube 由来である
-- （758チャンネルのクロールで distinct 店舗 11,141 / dish_media 12,557、#1319）。
-- ところが現行スキーマには2つの欠落があり、発見したものを表示できない。
--
-- 1. dish_media に render_type が無い。media_path/thumbnail_path は NOT NULL で
--    自社GCSのパスを前提としているため、外部埋め込み（oEmbed/iframe）を
--    クライアントで出し分ける手段が存在しない（#1273 §40）。
-- 2. dish_media_external_embeddings の provider CHECK が
--    ('instagram','tiktok','x') で **youtube を許可していない**
--    （20260812T0100_add_restaurant_recommendation_sync_metadata.sql:64）。
--    ①が生む dish_media は全て YouTube 由来なので、このままでは1行も入らない。
--
-- 【方針】
-- - 既存行の挙動を変えない。render_type は 'stored' をデフォルトにするため、
--   既存の自社GCS配信レコードは何も変わらない。
-- - provider の許可値を広げるだけで、既存の3プロバイダには影響しない。
--
-- このmigrationは dev/public の各search_pathで従来どおり適用する。
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. dish_media.render_type
-- -----------------------------------------------------------------------------
-- #1273 §40 【設計】'stored_media' = media_path の自社GCSオブジェクトを配信する既存経路、
-- 'external_embed' = dish_media_external_embeddings 側の埋め込みHTML/iframeで描画する経路。
-- 既存行は全て 'stored_media' 相当なのでdefaultで埋め、NOT NULL にしても後方互換を壊さない。
--
-- 【仕様】値は API 既存の規約 shared/api/v1/res/dish-media.response.ts:46
-- ('stored_media' | 'external_embed') に揃える。現状 dish-media.assembler.ts:79 は
-- external_embeddings 行の有無から renderType を**導出**しているが、
-- この列があれば join なしで external_embed だけを絞り込める。
-- 導出と列が食い違わないよう、書き込み側で両者を必ず同時に更新すること。
ALTER TABLE dish_media
  ADD COLUMN IF NOT EXISTS render_type TEXT NOT NULL DEFAULT 'stored_media';

ALTER TABLE dish_media
  DROP CONSTRAINT IF EXISTS dish_media_render_type_check;
ALTER TABLE dish_media
  ADD CONSTRAINT dish_media_render_type_check
  CHECK (render_type IN ('stored_media', 'external_embed'));

COMMENT ON COLUMN dish_media.render_type IS
  'stored_media=media_path の自社GCSを配信、external_embed=dish_media_external_embeddings の埋め込みで描画。値は shared/api/v1/res/dish-media.response.ts と同一。#1273 §40。';

-- #1273 【設計】external_embed の行だけを引くクエリが多くなるため部分indexを張る。
-- 既存の stored 行（大多数）はindexに載せないのでサイズが増えない。
CREATE INDEX IF NOT EXISTS dish_media_render_type_external_idx
  ON dish_media(render_type)
  WHERE render_type = 'external_embed';

-- -----------------------------------------------------------------------------
-- 2. provider に youtube を追加
-- -----------------------------------------------------------------------------
-- #1273 【バグ】①で確立した発見手法は YouTube 由来だが、既存CHECKが
-- ('instagram','tiktok','x') のみを許可しており1行も挿入できなかった。
-- YouTube は #1273 REPORT.md の実測で embeddable 98.8% / 生存率100% と
-- 埋め込みの土台が最も健全なプロバイダである。
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dish_media_external_provider_check;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dish_media_external_provider_check
  CHECK (provider IN ('instagram', 'tiktok', 'x', 'youtube'));

COMMENT ON COLUMN dish_media_external_embeddings.provider IS
  'instagram/tiktok/x/youtube。#1273 の①が生む dish_media は youtube 由来。';

COMMIT;
