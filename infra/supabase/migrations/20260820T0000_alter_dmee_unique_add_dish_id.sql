-- ==============================================================================
-- 20260820T0000_alter_dmee_unique_add_dish_id.sql
-- #1399（親 #1375 / 20260819T0200 の自然キーの見直し）
-- ==============================================================================
-- 【目的】
--   dish_media_external_embeddings の自然キーを
--     (provider, external_content_id)
--   から
--     (provider, external_content_id, dish_id)
--   へ広げる。
--
-- 【なぜ広げるのか】
--   SNS インポートは «1 投稿 1 行» で取り込む。同じ投稿を複数のユーザーが取り込んでも、
--   既存の «保存（reactions.action_type='save'）» が各ユーザーの棚を作るので、行は 1 本でよい。
--   困るのは **同じ投稿を別のユーザーが «別の料理» として分類した場合** である。
--   dishes は (restaurant_id, category_id) で一意なので、同じ動画でも
--   「この店のラーメン」と「この店のチャーシュー」は別 dish になり、
--   それぞれに dish_media を作る必要がある。旧キーではここで一意制約に当たり、
--   後から分類した側の取り込みが構造的に失敗していた。
--
--   dish_id を足すと «同じ投稿 × 同じ料理» の二重取り込みは今までどおり弾かれ、
--   «同じ投稿 × 別の料理» だけが通るようになる。二重取り込みの防止は失われない。
--
-- 【dish_id を «持たせる» ことの整合性】
--   dish_id は dish_media_id から一意に決まる（dish_media.dish_id）ので、
--   放っておくと実体とズレうる冗長列になる。ズレを DB で構造的に禁じるため、
--   (dish_media_id, dish_id) → dish_media(id, dish_id) の複合外部キーを張る。
--   そのために dish_media 側へ UNIQUE (id, dish_id) を 1 本足す
--   （id は既に PK なので選択性は変わらない。複合 FK の参照先要件を満たすためだけの索引）。
--
-- 【ロールバック】
--   ALTER TABLE dish_media_external_embeddings
--     DROP CONSTRAINT IF EXISTS dmee_provider_content_dish_uq,
--     DROP CONSTRAINT IF EXISTS dmee_dish_media_dish_fk,
--     DROP COLUMN IF EXISTS dish_id;
--   ALTER TABLE dish_media_external_embeddings
--     ADD CONSTRAINT dmee_provider_content_uq UNIQUE (provider, external_content_id);
--   DROP INDEX IF EXISTS uq_dish_media_id_dish_id;
--
-- ⚠️ scripts/apply-migration.sh は from_file 以降を毎回全部流し、--single-transaction を
--    付けない。よって本ファイルは **何度流しても同じ結果になる** 形で書いてある
--    （ADD CONSTRAINT に IF NOT EXISTS が無いため、必ず DROP CONSTRAINT IF EXISTS を前に置く）。
-- ==============================================================================

-- ------------------------------------------------------------------
-- 1. dish_id 列を足す（まず NULL 許容で足して、埋めてから NOT NULL にする）
-- ------------------------------------------------------------------
ALTER TABLE dish_media_external_embeddings
  ADD COLUMN IF NOT EXISTS dish_id uuid;

UPDATE dish_media_external_embeddings dmee
   SET dish_id = dm.dish_id
  FROM dish_media dm
 WHERE dm.id = dmee.dish_media_id
   AND dmee.dish_id IS DISTINCT FROM dm.dish_id;

ALTER TABLE dish_media_external_embeddings
  ALTER COLUMN dish_id SET NOT NULL;

COMMENT ON COLUMN dish_media_external_embeddings.dish_id IS 'この埋め込みが紐づく料理（dish_media.dish_id と必ず一致する。複合 FK dmee_dish_media_dish_fk で保証）。自然キーに含めることで «同じ投稿 × 別の料理» の取り込みを許し、«同じ投稿 × 同じ料理» の二重取り込みは弾く。#1399';

-- ------------------------------------------------------------------
-- 2. 複合外部キーの参照先要件を満たす索引を dish_media に張る
--    （id は PK なので (id, dish_id) も当然一意。FK の参照先として必要なだけ）
-- ------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_dish_media_id_dish_id
  ON dish_media (id, dish_id);

COMMENT ON INDEX uq_dish_media_id_dish_id IS 'dish_media_external_embeddings の複合 FK (dish_media_id, dish_id) の参照先。#1399';

-- ------------------------------------------------------------------
-- 3. dish_id が dish_media の実体とズレないことを DB で保証する
--    NOT VALID で即時に張ってから VALIDATE する（VALIDATE は弱いロックで済む）
-- ------------------------------------------------------------------
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_dish_media_dish_fk;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_dish_media_dish_fk
  FOREIGN KEY (dish_media_id, dish_id)
  REFERENCES dish_media (id, dish_id)
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE dish_media_external_embeddings
  VALIDATE CONSTRAINT dmee_dish_media_dish_fk;

-- ------------------------------------------------------------------
-- 4. 自然キーを張り替える
--    ⚠️ 旧キーを先に落とすこと。両方が同時に載っていると、
--       «同じ投稿 × 別の料理» が旧キーに引っかかって通らない
-- ------------------------------------------------------------------
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_provider_content_uq;
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_provider_content_dish_uq;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_provider_content_dish_uq
  UNIQUE (provider, external_content_id, dish_id);

-- 20260819T0200 の列コメントを新しい自然キーへ合わせて上書きする
COMMENT ON COLUMN dish_media_external_embeddings.external_content_id IS 'provider 側の投稿ID（動画IDなど）。(provider, external_content_id, dish_id) で一意（#1399 で dish_id を追加）。同じ投稿を別の料理として分類する取り込みは通し、同じ料理への二重取り込みは弾く';
