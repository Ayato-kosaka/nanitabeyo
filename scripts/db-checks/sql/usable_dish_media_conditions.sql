-- 自動生成。手で書かない。
-- 正本: api/src/v1/dish-media/usable-dish-media-filter.ts
-- 書き出し: UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest usable-dish-media-filter.spec.snapshot
--
-- dish_media のエイリアスは dm であることが前提（埋め込み先で必ず dm を使う）。
-- WHERE 句の末尾へそのまま連結できるよう、各行が AND で始まる。
AND dm.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = dm.user_id
      AND u.deleted_at IS NOT NULL
  )
  AND dm.media_processing_status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM dish_media_external_embeddings dmee
    WHERE dmee.dish_media_id = dm.id
      AND dmee.playback_status = 'not_playable'
  )
