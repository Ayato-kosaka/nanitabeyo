-- =============================================================================
-- #721 share_links.created_by の users への外部キーを外す
--
-- ## 何が起きたか（実測）
-- 20260807T0000 の初版は `created_by uuid NULL REFERENCES users(id)` だった。
-- このアプリのユーザーは Supabase Auth の匿名サインインで始まり、**匿名ユーザーには
-- `users` 行が存在しない**ため、匿名ユーザーからの共有が必ず失敗する。
--
-- api-development で実測（BigQuery nanitabeyo_logs_dev / 2026-08-07 19:36 UTC）:
--
--   POST /v1/share-links → 500 INTERNAL_ERROR
--   PrismaClientKnownRequestError:
--     Invalid `prisma.share_links.create()` invocation:
--     Foreign key constraint violated on the constraint: `share_links_created_by_fkey`
--
-- ## 「users へ FK を張らない」は一般則ではない
-- dish_media / dish_reviews / dish_media_likes / restaurant_bids は `users(id)` へ
-- FK を張っている。あれらは **ログイン済みユーザーしか行を作れない**列なので正しい。
-- 判断は列ごとで、基準は「その列に匿名ユーザーの id が入りうるか」の一点。
-- 入りうるなら FK は張れない（友達投票 20260623T0000 も同じ理由で外している）。
--
-- ## なぜ 20260807T0000 の修正と «両方» 要るのか
-- - 20260807T0000 は「初めからこの列に FK を付けない」形へ直した。
--   まだ main へ入っておらず public（本番）へは一度も当たっていないので、
--   新規環境と本番が誤った制約を経由しなくて済む。
-- - dev には **初版がすでに適用済み**で、実物に制約が残っている。
--   ファイルを直しただけでは消えないため、このファイルで落とす。
--
-- どちらの経路でも最終状態は同じになる。`IF EXISTS` なので、初版を経由していない
-- 環境でこのファイルが流れても何も起きない。
-- =============================================================================

ALTER TABLE share_links
  DROP CONSTRAINT IF EXISTS share_links_created_by_fkey;

-- 索引 idx_share_links_created_by_created_at は FK とは独立に張ってあるので残す
--（「自分が作った共有リンク一覧」を引くために要る）。

COMMENT ON COLUMN share_links.created_by IS
  '共有リンクを作成した Supabase Auth user id。匿名ユーザーもあり users 行が必ず存在する前提ではないため FK は張らない。NULL 可';

-- =============================================================================
-- 事後アサーション
--
-- `DROP CONSTRAINT IF EXISTS` は制約が無くても成功するので、**「流した」ことと
-- 「制約が消えている」ことは別**。適用ログが success でも、対象スキーマを取り違えて
-- いれば本来の schema には残ったままになる。それを後から気付ける材料がどこにも
-- 残らないので、ここで実際の状態を検査して落とす。
--
-- 再実行しても安全（冪等）。むしろ **再実行が「今の dev は FK が無い」ことの証明**になる。
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'share_links'::regclass
      AND contype  = 'f'
      AND conname  = 'share_links_created_by_fkey'
  ) THEN
    RAISE EXCEPTION
      'share_links_created_by_fkey がまだ存在します（search_path: %）。匿名ユーザーからの共有が 500 になります。',
      current_schema();
  END IF;

  RAISE NOTICE '✅ share_links_created_by_fkey は存在しません（schema: %）', current_schema();
END $$;
