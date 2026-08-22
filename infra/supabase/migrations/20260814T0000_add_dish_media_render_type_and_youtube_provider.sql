-- =============================================================================
-- #1273 SNS由来 dish_media を表示可能にするための最小スキーマ変更
-- =============================================================================
--
-- 【背景】
-- #1273 の①（無料での dish_media 発見）で確立した手法は YouTube 由来である
-- （758チャンネルのクロールで distinct 店舗 11,141 / dish_media 12,557、#1319）。
-- ところが現行スキーマには dish_media に render_type が無く、
-- media_path/thumbnail_path は NOT NULL で自社GCSのパスを前提としているため、
-- 外部埋め込み（oEmbed/iframe）をクライアントで出し分ける手段が存在しない（#1273 §40）。
--
-- 【方針】
-- - 既存行の挙動を変えない。render_type は 'stored' をデフォルトにするため、
--   既存の自社GCS配信レコードは何も変わらない。
--
-- 【⚠️ 2026-08-21 #1375 との衝突解消でこのファイルを 2 箇所直した】
--
-- 1. **render_type の値を 'stored_media' → 'stored' へ改めた。**
--    #1375（#1395）の 20260819T0100_add_render_type_to_dish_media.sql が同じ列を
--    'stored' で足しており、CHECK 制約名も同じ dish_media_render_type_check だった。
--    ADD COLUMN IF NOT EXISTS は «先勝ち»、CHECK は DROP→ADD なので «後勝ち» になり、
--    どちらの順で流しても «既存行の値が新しい CHECK に違反して適用が失敗する» 状態だった。
--    値を 'stored' に統一して解消した。#1375 側は shared の型・assembler・テストまで
--    'stored' で揃っているため、変更量の小さいこちらを合わせている。
--
-- 2. **dish_media_external_embeddings の provider CHECK 変更をこのファイルから外した。**
--    あのテーブルの作成元は 20260819T0200 に一本化された（20260823T0000 から
--    CREATE TABLE を外した）。つまりこのファイルの時点では **まだテーブルが存在しない**ので、
--    ここで ALTER すると確実に失敗する。
--    provider の値域は 20260819T0200 が最初から
--    ('instagram','tiktok','youtube','x') の 4 種で作るため、追加の変更自体が不要になった。
--
-- このmigrationは dev/public の各search_pathで従来どおり適用する。
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- dish_media.render_type
-- -----------------------------------------------------------------------------
-- #1273 §40 【設計】'stored' = media_path の自社GCSオブジェクトを配信する既存経路、
-- 'external_embed' = dish_media_external_embeddings 側の埋め込みで描画する経路。
-- 既存行は全て 'stored' 相当なのでdefaultで埋め、NOT NULL にしても後方互換を壊さない。
--
-- 【仕様】値は API 既存の規約 shared/api/v1/res/dish-media.response.ts
-- ('stored' | 'external_embed') に揃える。現状 dish-media.assembler.ts は
-- external_embeddings 行の有無から renderType を**導出**しているが、
-- この列があれば join なしで external_embed だけを絞り込める。
-- 導出と列が食い違わないよう、書き込み側で両者を必ず同時に更新すること。
--
-- ⚠️ #1375 の 20260819T0100 が同じ列に対して «media_path を NULL 許容にし、
--    render_type='stored' のときだけ必須» という CHECK を追加で張る。
--    このファイルと同じ値域なので競合しない（何度流しても同じ結果になる）。
ALTER TABLE dish_media
  ADD COLUMN IF NOT EXISTS render_type TEXT NOT NULL DEFAULT 'stored';

ALTER TABLE dish_media
  DROP CONSTRAINT IF EXISTS dish_media_render_type_check;
ALTER TABLE dish_media
  ADD CONSTRAINT dish_media_render_type_check
  CHECK (render_type IN ('stored', 'external_embed'));

COMMENT ON COLUMN dish_media.render_type IS
  'stored=media_path の自社GCSを配信、external_embed=dish_media_external_embeddings の埋め込みで描画。値は shared/api/v1/res/dish-media.response.ts と同一。#1273 §40。';

-- #1273 【設計】external_embed の行だけを引くクエリが多くなるため部分indexを張る。
-- 既存の stored 行（大多数）はindexに載せないのでサイズが増えない。
CREATE INDEX IF NOT EXISTS dish_media_render_type_external_idx
  ON dish_media(render_type)
  WHERE render_type = 'external_embed';

COMMIT;
