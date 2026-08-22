-- ==============================================================================
-- 20260822T0000_add_external_embedding_thumbnail_columns.sql
-- #1399（親 #1375）SNS URL 取り込みの保存に必要な 2 列を足す
-- ==============================================================================
-- 【目的】
--   取り込んだ外部投稿の「サムネイル」と「投稿日時」を持てるようにする。
--
-- 【なぜ thumbnail_path（自ストレージ）ではなく URL なのか】
--   #1399 の権利調査の結論により、**サムネイルは複製せず参照する**。
--
--     - Instagram … 画像の persisting（複製・保存）が利用規約で明示的に禁じられている
--     - TikTok    … og:image は参照できるが、CDN の署名 URL は約 48 時間で失効するため
--                   「複製せずに直接参照し続ける」ことはできない
--     - YouTube   … i.ytimg.com のサムネイルは無署名・安定で、直接参照できる
--
--   provider ごとに扱いが違うので「全部を自ストレージへ複製する」も
--   「全部を直接参照する」も成立しない。ここでは **provider 側の URL を保持するだけ**にし、
--   複製するかどうかの判断を後から変えられるようにしておく。
--   取れなかった provider では NULL になり、表示は料理カテゴリ画像へ落ちる
--   （app-expo の `resolveMyDishThumbnailUrl` が既にその順で解決している）。
--
--   ⚠️ dish_media.thumbnail_path（NOT NULL）とは**別物**である。あちらは自ストレージの
--   パスで、external_embed の行では実体が無いため空文字が入る。
--   `DishMediaAssembler.getMediaUrl` が render_type='external_embed' で署名 URL を
--   作らないのと同じ理由で、サムネイルもこちら（thumbnail_url）を優先して使う。
--
-- 【なぜ embed_html を置かないのか】
--   置かない。#1375 設計の正本 §2 / #1273 §14 のとおり、oEmbed が返す HTML を
--   永続的な SoT にすると provider 側の仕様変更に追随できなくなる。埋め込みは
--   canonical_url から provider 別コンポーネントが都度描画する。
--   （#1480 のブランチには embed_html を保存する実装があるが、こちらの方針で確定し、
--   #1480 側を後から合わせる）
--
-- 【安全性】
--   どちらも NULLABLE の追加のみ。既存行は書き換わらず、ロックは短い ACCESS EXCLUSIVE
--   （デフォルト値を持たない ADD COLUMN なので、テーブル全体の書き換えは起きない）。
-- ==============================================================================

ALTER TABLE dish_media_external_embeddings
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ(6);

COMMENT ON COLUMN dish_media_external_embeddings.thumbnail_url IS
  'provider 側のサムネイル URL（参照であって複製ではない）。取得できなければ NULL。'
  '複製の可否は provider ごとに異なる（Instagram は禁止 / TikTok の署名 URL は約48hで失効 / '
  'YouTube の i.ytimg.com は無署名で安定）ため、ここでは URL のみを保持する。';

COMMENT ON COLUMN dish_media_external_embeddings.published_at IS
  'provider 側の投稿日時。oEmbed から取れない provider では NULL。'
  'アプリ内の並び順には使わない（自分が保存した日時＝reactions.created_at を使う）。';
