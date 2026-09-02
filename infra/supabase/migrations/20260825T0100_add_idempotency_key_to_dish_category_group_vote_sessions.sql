-- ==============================================================================
-- 20260825T0100_add_idempotency_key_to_dish_category_group_vote_sessions.sql
-- #1507 (GRP-14)
-- ==============================================================================
-- 【目的】
-- POST /v1/dish-category-group-votes の再送で投票セッションが二重に作られるのを、
-- DB 制約を最終防衛線としてサーバー側で防ぐ。クライアント生成の冪等キーを
-- session 行そのものに刻む方式にする。
--
-- 【背景】
-- 現在の防御はフロントの useRef 同期ガードだけで（#1205）、
-- app-expo/features/dishCategoryGroupVotes/hooks/useCreateDishCategoryGroupVote.ts の
-- コメントにその限界が既に書かれている。通信のリトライ、オフライン復帰後の再送、
-- コンポーネント再マウントでは ref が守れず、**別々の share_token を持つ
-- 投票セッションが 2 件できる**。投票は共有リンクで完結するため、
-- 「片方のリンクを配った参加者」と「もう片方を見ているホスト」が別の投票を見ることになり、
-- 集計が合わないまま気付かれない。
--
-- 【実装方針】
-- - NULL 許容・DEFAULT なし。冪等キー未対応の旧クライアントと既存行の挙動を変えない
--   （PostgreSQL の UNIQUE は NULL 同士を衝突と見なさないため、キー無しの行は何件でも入る）。
-- - 型は notifications.idempotency_key（20251031T0001_create_notifications.sql:15）と同じ text。
--   ただしあちらはサーバー生成キーなので単独 UNIQUE なのに対し、こちらは**クライアント生成**の
--   キーなので (host_user_id, idempotency_key) の複合一意にする。単独 UNIQUE だと
--   (a) 別ユーザーが偶然同じキーを送っただけで 2 人目の作成が失敗する
--   (b) 同一キー再送で他人のセッション（share_token 込み）を返す漏洩経路ができる。
--   複合にすることで「既存行を返す」経路が本人の行しか返さないことを制約レベルで保証する。
-- - ADD CONSTRAINT は IF NOT EXISTS を取れないため、
--   20260825T0100_add_idempotency_key_to_dish_category_group_vote_sessions.sql:31-33 の前例に合わせて
--   CREATE UNIQUE INDEX IF NOT EXISTS で張る（Prisma も @@unique として認識するので
--   findUnique が使える）。
--
-- 【既存データへの影響】
-- なし。NULL 許容・DEFAULT なしの列追加はテーブル書き換えを伴わないメタデータ変更で、
-- 既存行は全て idempotency_key = NULL のまま。バックフィルは不要。
-- unique index の作成も全行 NULL の小規模テーブルなので一瞬で終わり、CONCURRENTLY は要らない。
--
-- このmigrationは dev/public の各search_pathで従来どおり適用する。
-- ==============================================================================

BEGIN;

ALTER TABLE dish_category_group_vote_sessions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN dish_category_group_vote_sessions.idempotency_key IS
  'クライアント生成の冪等キー（UUID v4）。同一ホストからの再送で新規セッションを作らず既存行を返すために使う。キーを送らない旧クライアント経由の行は NULL。';

CREATE UNIQUE INDEX IF NOT EXISTS dcgvs_host_user_id_idempotency_key_uq
  ON dish_category_group_vote_sessions (host_user_id, idempotency_key);

COMMIT;

-- rollback（必要時に手動実施）:
-- DROP INDEX IF EXISTS dcgvs_host_user_id_idempotency_key_uq;
-- ALTER TABLE dish_category_group_vote_sessions DROP COLUMN IF EXISTS idempotency_key;
