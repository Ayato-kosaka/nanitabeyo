-- =============================================================================
-- #1599 通知ジョブが再配送されると Push が二重に届く件
--   notification_recipients に「どの actor の分まで Push 済みか」を持たせる
--
-- ## 目的
-- Cloud Tasks は **at-least-once** 配送である。タイムアウトや 5xx だけでなく、
-- **ハンドラが成功したのに応答が届かなかった場合も再実行される**。
--
-- `internal/notifications/notification-job.service.ts` は
--   1. upsertNotification（idempotency_key で冪等。行は二重にならない）
--   2. sendPushNotification（**無条件に実行**）
-- という順で動くため、再配送されると **同じ Push がユーザーへ 2 回届く**。
--
-- 行の冪等性（1）と配信の冪等性（2）は別の話であり、
-- `notifications.service.ts` の doc comment にある
-- 「idempotency_key があるので再実行しても通知が二重にならない」は
-- **行のことしか保証していない**。
--
-- ## なぜ「新規作成のときだけ Push」では駄目なのか
-- `upsertNotification` の戻り値 `isNew` で分岐したくなるが、それでは
-- **同じ投稿への 2 人目以降のいいね通知が丸ごと消える**。
-- `idempotency_key` は (action_type, target_table, target_id) 単位で共有され、
-- 2 人目は「既存通知の actor_ids を更新」する経路（isNew: false）に入るためである。
-- 「再配送」と「正当な追加イベント」を区別する必要がある。
--
-- ## なぜ既存の列では判別できないのか（実装を読んで確認した）
--   - `actor_ids` … **先頭 3 件までの MRU リスト**（notifications.repository.ts）。
--     同じ actor の再配送では中身が変わらないので「差分あり = 新イベント」と言えない。
--     さらに上限 3 に張り付くと、4 人目以降は件数も変わらない
--   - `thread_updated_at` … 再配送でも **毎回 now() で更新される**ので時刻比較も使えない
-- したがって「**誰の分まで送ったか**」を持つ列を足すしかない。
--
-- ## 設計判断
-- - **キーは (notification_id, recipient_id) = notification_recipients の PK。**
--   Push は受取人ごとに送るので、重複判定も受取人ごとでなければならない
-- - **actor の «集合» ではなく «最後に Push した actor» を持つ。**
--   集合にすると際限なく伸びる（actor_ids は 3 で切られるが Push は何度でも起きる）。
--   守りたいのは「同じタスクの再配送で二重に送らない」であり、それには最後の 1 件で足りる
-- - **NULL 許容。** 既存行はすべて「まだ Push していない」として扱われる。
--   NULL 許容カラムの追加なのでテーブル書き換えは発生しない（メタデータ操作のみ）
-- - **索引は張らない。** この 2 列は必ず PK で 1 行に絞ったうえで読み書きするので、
--   単独のスキャン条件にはならない
--
-- ## 使い方（アプリ側）
-- 「送ってから記録する」ではなく **「記録できたら送る」**（claim-then-push）にする。
--
--   UPDATE notification_recipients
--      SET last_pushed_actor_id = :actorId, last_pushed_at = now()
--    WHERE notification_id = :id
--      AND recipient_id = :recipientId
--      AND last_pushed_actor_id IS DISTINCT FROM :actorId
--
-- 更新できた（count = 1）ときだけ Push する。0 なら誰かが既に送っている。
-- 1 文の条件付き UPDATE なので、再配送が同時に 2 本届いても片方しか通らない。
--
-- ## ロールバック
--   ALTER TABLE notification_recipients
--     DROP COLUMN IF EXISTS last_pushed_actor_id,
--     DROP COLUMN IF EXISTS last_pushed_at;
-- 列を落とすと二重 Push の抑止が無くなるだけで、通知そのものは従来どおり動く。
-- =============================================================================

ALTER TABLE notification_recipients
  ADD COLUMN IF NOT EXISTS last_pushed_actor_id uuid NULL,
  ADD COLUMN IF NOT EXISTS last_pushed_at       timestamptz NULL;

COMMENT ON COLUMN notification_recipients.last_pushed_actor_id IS
  'この受取人へ最後に Push 配信したときの actor。Cloud Tasks の再配送で同じ Push を二度送らないための claim 用。NULL = まだ一度も送っていない (#1599)';

COMMENT ON COLUMN notification_recipients.last_pushed_at IS
  '最後に Push 配信を claim した時刻。観測用（配信の遅延や取りこぼしを追うため）で、判定には使わない (#1599)';

-- =============================================================================
-- 事後アサーション
--
-- `ADD COLUMN IF NOT EXISTS` は列が既にあっても成功するので、**「流した」ことと
-- 「対象スキーマに列がある」ことは別**である（適用先スキーマの取り違えは
-- 適用ログが success でも起きうる）。実際の状態を検査して落とす。
-- 再実行しても安全（冪等）。
-- =============================================================================
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO missing
    FROM unnest(ARRAY['last_pushed_actor_id', 'last_pushed_at']) AS expected
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name   = 'notification_recipients'
        AND column_name  = expected
   );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'notification_recipients に % がありません（schema: %）。Push の二重配信を抑止できません。',
      missing, current_schema();
  END IF;

  RAISE NOTICE '✅ notification_recipients.last_pushed_actor_id / last_pushed_at 追加済み（schema: %）', current_schema();
END $$;
