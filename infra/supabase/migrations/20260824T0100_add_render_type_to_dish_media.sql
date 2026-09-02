-- NOTE: 旧 20260819T0100_add_render_type_to_dish_media.sql からのリネーム（#1469 ブランチが dev へ旧名で先行適用済み。SQL 本体は同一で、全体が冪等なので再適用は無害）。
-- リネーム理由: main の 20260823T0000 より後ろに並べ、「ファイル名順 = 適用順」を守るため。
-- ==============================================================================
-- 20260819T0100_add_render_type_to_dish_media.sql
-- #1395（親 #1375 / #1273 §40 準拠）
-- ==============================================================================
-- 【目的】
--   1) dish_media.render_type（'stored' / 'external_embed'）を追加する
--   2) dish_media.media_path の NOT NULL を解除する（external_embed には実体が無い）
--   3) 上記を破らないための CHECK 制約を張る
--
-- 【背景】
--   - #1375 の設計の正本 §6:「動画本体は保存しない（公式埋め込みを使う）。
--     サムネイル画像のみ自ストレージへ保存する」
--   - よって external_embed の行には media_path に相当する実体が無い。
--     一方 thumbnail_path は NOT NULL を維持する（nullable 化すると
--     DishMediaEntry.thumbnailImageUrl: string が破壊的変更になり、
--     リスト・Map・Calendar・検索フィードの全読み取り経路へ波及するため）。
--   - サムネイルは **全 provider について取り込み時に自ストレージへ保存する**
--     （統一キャッシュ方式。#1395 の仕様追補で確定）。よってサムネイルの置き場は
--     thumbnail_path 一本であり、外部 CDN URL を持つ列は追加しない。
--     1 つの概念の置き場を 2 列に分けると読み取り分岐が全経路へ波及するため。
--     YouTube の 30 日ルールは「30 日 TTL で再取得するバッチ」で準拠する（#1399）。
--
-- 【media_path に canonical_url を入れる案を却下した理由】
--   dish-media.assembler.ts の buildCdnUrlFromPath() が
--   `https://${CDN_HOST}/${gcsPath}` を組み立てるため、media_path に
--   'https://tiktok.com/...' を入れると
--   'https://cdn.example/https://tiktok.com/...' という壊れた URL になる。
--
-- 【render_type='external_embed' の行が NOT NULL 列に入れる値（#1395 レビュー M-3）】
--   dish_media.media_processing_status / thumbnail_processing_status は
--   どちらも NOT NULL でデフォルトが無いため、取り込み側が必ず値を入れる必要がある。
--   本 Issue で下記の規約に確定する（#1399 の前提と矛盾させないこと）:
--     - media_processing_status     = 'idle'
--       （自ストレージに実体が無く、リサイズもトランスコードも発生しないため。
--         'idle' は MediaProcessingStatus の「まだ何もしていない」に対応する）
--     - thumbnail_processing_status = 'processing'
--       （サムネイルは取り込み後にリサイズを走らせる。#1399 がこの値を前提にしている）
--   この規約は下記 COMMENT ON COLUMN にも記録する。
--
-- 【CHECK 制約の張り方】
--   CHECK をインラインで書くと既存全行の検証中 ACCESS EXCLUSIVE を保持する。
--   NOT VALID で即時に張ってから VALIDATE する（VALIDATE は弱いロックで済む）。
--
-- 【⚠️ ADD CONSTRAINT に IF NOT EXISTS は無い（#1395 レビュー m-2）】
--   scripts/apply-migration.sh は from_file 以降の全ファイルを毎回順に流すため、
--   このファイルは複数回実行されうる。ADD CONSTRAINT は 2 回目に
--     ERROR: constraint "..." for relation "dish_media" already exists
--   で ON_ERROR_STOP に引っかかり、**以降のマイグレーションが全部止まる**。
--   よって ADD CONSTRAINT の直前に必ず DROP CONSTRAINT IF EXISTS を置く
--   （20251224T0005_update_dish_category_variants_constraints.sql:36-40 の作法）。
--
-- 【ロールバック】
--   ALTER TABLE dish_media DROP CONSTRAINT IF EXISTS dish_media_media_path_required_for_stored;
--   ALTER TABLE dish_media DROP CONSTRAINT IF EXISTS dish_media_render_type_check;
--   ALTER TABLE dish_media ALTER COLUMN media_path SET NOT NULL;   -- external_embed 行が入る前に限る
--   ALTER TABLE dish_media DROP COLUMN IF EXISTS render_type;
-- ==============================================================================

-- ------------------------------------------------------------------
-- 1) render_type
--    PG11+ の非 volatile DEFAULT 付き ADD COLUMN はテーブル書き換えを伴わない
-- ------------------------------------------------------------------
ALTER TABLE dish_media
  ADD COLUMN IF NOT EXISTS render_type text NOT NULL DEFAULT 'stored';

COMMENT ON COLUMN dish_media.render_type IS
  'メディアの実体をどこから描画するか。stored=自ストレージ（media_path 必須）／external_embed=SNS の公式埋め込み（media_path は NULL、表示は dish_media_external_embeddings.canonical_url から provider 別コンポーネントが行う）。#1273 §40 / #1395';

ALTER TABLE dish_media
  DROP CONSTRAINT IF EXISTS dish_media_render_type_check;
ALTER TABLE dish_media
  ADD CONSTRAINT dish_media_render_type_check
  CHECK (render_type IN ('stored','external_embed')) NOT VALID;
ALTER TABLE dish_media VALIDATE CONSTRAINT dish_media_render_type_check;

-- ------------------------------------------------------------------
-- 2) media_path の NOT NULL 解除 + stored のときだけ必須にする CHECK
-- ------------------------------------------------------------------
ALTER TABLE dish_media ALTER COLUMN media_path DROP NOT NULL;

COMMENT ON COLUMN dish_media.media_path IS
  '自ストレージ上のメディア実体パス。render_type=''stored'' のとき必須、''external_embed'' のときは NULL（動画本体は保存せず公式埋め込みを使うため）。#1395';

ALTER TABLE dish_media
  DROP CONSTRAINT IF EXISTS dish_media_media_path_required_for_stored;
ALTER TABLE dish_media
  ADD CONSTRAINT dish_media_media_path_required_for_stored
  CHECK (render_type <> 'stored' OR media_path IS NOT NULL) NOT VALID;
ALTER TABLE dish_media VALIDATE CONSTRAINT dish_media_media_path_required_for_stored;

-- ------------------------------------------------------------------
-- 3) 既存の NOT NULL 列に対する external_embed 時の規約を DB に記録する
--    （#1395 レビュー M-3。列定義は変更しない）
-- ------------------------------------------------------------------
COMMENT ON COLUMN dish_media.media_processing_status IS
  'メディア加工ステータス（idle / processing / completed / failed）。render_type=''external_embed'' の行は実体を持たず加工も発生しないため ''idle'' を入れる（#1395）';

COMMENT ON COLUMN dish_media.thumbnail_processing_status IS
  'サムネイル加工ステータス（idle / processing / completed / failed）。render_type=''external_embed'' の行は取り込み後にリサイズを走らせるため ''processing'' を入れる（#1395 / #1399 がこの値を前提にしている）';
