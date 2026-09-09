-- ==============================================================================
-- 20260903T0000_create_restaurant_opening_hours.sql
-- #1788 / #1666 / #288 / #843
-- ==============================================================================
-- 【目的】
-- 店の営業時間を持つ。新規テーブル 2 つの追加のみで、既存テーブルは 1 列も変えない。
--
-- 【なぜ必要か】
-- 「朝食」を選んだのに営業時間外の店が出る（#288）。いま店を選ぶ処理は営業時間を
-- **一切見ていない**。「朝食」で効いているのは dish_category_features の timeSlot
-- （＝料理カテゴリ側のスコア）で restaurant_id を持たず、店を選ぶ
-- searchNearbyRestaurants に営業時間の条件は 1 つも無い。restaurants にも列が無い。
-- dish-media.repository.ts に営業時間チェックの土台がコメントアウトのまま残っているが、
-- 参照先の `restaurant_open_hours` は実在しない。その受け口をここで作る。
--
-- 【設計で決めたこと（#1788 でオーナー承認済み）】
--
-- ① 出所（source）を主キーに含める
--   restaurant_links は属性ごとに 1 つの値へ収束させるが、営業時間は **OSM と公式サイトで
--   曜日ごとに食い違うのが普通**である。競合する主張を全部残し、表示・判定のときに
--   official_site > osm > user の優先順で解決する。
--
-- ② JSONB ではなく列にする
--   「今開いている店」を索引で絞り込むため。JSONB だと全件展開になる。
--
-- ③ 深夜営業を最初から扱う
--   18:00–02:00 のような店は飲食店では普通で closes_at < opens_at になる。
--   crosses_midnight を持ち、判定 SQL で日をまたぐ側も拾う。
--   ここを後回しにすると、朝食の逆（夜の検索）が静かに壊れる。
--
-- 【判定は 3 値にする（#1666 側の本体。この migration の前提）】
--   closed  = 営業時間が分かっていて、今閉まっている → 検索結果から除外する
--   unknown = 営業時間が分からない                   → 今と同じ。無条件で候補に残す
--   open    = 分かっていて開いている                 → 現状の重みどおり微加点
--   営業時間が分かる店は当面ごく一部（OSM が約 62 万店のうち約 1.1%）なので、
--   EXISTS(...) の 2 値にすると「データが無い店」と「閉まっている店」が同じ値になり、
--   ほぼ無風で #288 は直らない。3 値にして closed だけを外せば、coverage が 1% でも
--   既存の 99% の体験を変えずに、分かっている分だけ確実に良くなる。
--
-- 【既存データへの影響】
-- 無し。テーブル新設のみで、既存行の書き換えも列の削除も無い。
--
-- 【ロールバック】
--   DROP TABLE IF EXISTS restaurant_hours_exceptions;
--   DROP TABLE IF EXISTS restaurant_opening_hours;
--
-- 【冪等性】（README 規則 5）
-- apply-migration.sh は from_file 以降を毎回全部流すため、CREATE TABLE IF NOT EXISTS は
-- 既にテーブルがある環境ではスキップされる。制約・索引は DROP ... IF EXISTS → ADD の
-- 形で毎回貼り直し、何度流しても同じ結果になるようにしてある。
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------
-- 曜日ごとの営業時間
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restaurant_opening_hours (
  restaurant_id     UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- どこから得たか。競合する主張を全部残すため主キーに含める。
  source            TEXT NOT NULL,

  -- 0 = 日曜 … 6 = 土曜（PostgreSQL の EXTRACT(DOW) と同じ並び）。
  day_of_week       SMALLINT NOT NULL,

  opens_at          TIME NOT NULL,
  closes_at         TIME NOT NULL,

  -- closes_at < opens_at（18:00–02:00 のような深夜営業）のとき TRUE。
  -- 判定 SQL はこの列を見て「前日の営業が今日へ食い込んでいる」側も拾う。
  crosses_midnight  BOOLEAN NOT NULL DEFAULT FALSE,

  -- いつ取得したか。鮮度の判断に使う。
  fetched_at        TIMESTAMPTZ NOT NULL,

  -- 公式サイトから取ったときの取得元 URL。
  source_url        TEXT,

  -- 1 日に複数コマ（昼 11:00–14:00 / 夜 17:00–23:00）があるので opens_at まで含める。
  PRIMARY KEY (restaurant_id, source, day_of_week, opens_at)
);

ALTER TABLE restaurant_opening_hours
  DROP CONSTRAINT IF EXISTS restaurant_opening_hours_day_of_week_check;
ALTER TABLE restaurant_opening_hours
  ADD CONSTRAINT restaurant_opening_hours_day_of_week_check
  CHECK (day_of_week BETWEEN 0 AND 6);

ALTER TABLE restaurant_opening_hours
  DROP CONSTRAINT IF EXISTS restaurant_opening_hours_source_check;
ALTER TABLE restaurant_opening_hours
  ADD CONSTRAINT restaurant_opening_hours_source_check
  CHECK (source IN ('osm', 'official_site', 'user', 'owner'));

-- crosses_midnight が実際の時刻と食い違うと判定 SQL が静かに間違える。
-- 「日をまたぐかどうか」は opens_at / closes_at から一意に決まるので、DB 側で固定する。
-- （closes_at = opens_at は「24 時間営業」の意味なので またぐ 側に入れる）
ALTER TABLE restaurant_opening_hours
  DROP CONSTRAINT IF EXISTS restaurant_opening_hours_crosses_midnight_check;
ALTER TABLE restaurant_opening_hours
  ADD CONSTRAINT restaurant_opening_hours_crosses_midnight_check
  CHECK (crosses_midnight = (closes_at <= opens_at));

COMMENT ON TABLE restaurant_opening_hours IS
  '店の曜日ごとの営業時間。OSM と公式サイトで食い違うのが普通なので、出所を主キーに含めて '
  '競合する主張を全部残す（解決は表示・判定のときに official_site > osm > user の順）。';

-- 「この店の、この曜日」で引く（判定 SQL の主経路）。
CREATE INDEX IF NOT EXISTS idx_restaurant_opening_hours_lookup
  ON restaurant_opening_hours(restaurant_id, day_of_week);

-- ------------------------------------------------------------------
-- 特定日の休業・時間変更（年末年始・臨時休業）
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restaurant_hours_exceptions (
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  exception_date  DATE NOT NULL,

  -- TRUE ならその日は終日休業。FALSE なら opens_at / closes_at で置き換える。
  is_closed       BOOLEAN NOT NULL,

  opens_at        TIME,
  closes_at       TIME,

  fetched_at      TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (restaurant_id, source, exception_date)
);

ALTER TABLE restaurant_hours_exceptions
  DROP CONSTRAINT IF EXISTS restaurant_hours_exceptions_source_check;
ALTER TABLE restaurant_hours_exceptions
  ADD CONSTRAINT restaurant_hours_exceptions_source_check
  CHECK (source IN ('osm', 'official_site', 'user', 'owner'));

-- is_closed = FALSE は「その日だけこの時間」なので、時刻が両方無いと意味を成さない。
-- is_closed = TRUE のときは時刻を持たない。
ALTER TABLE restaurant_hours_exceptions
  DROP CONSTRAINT IF EXISTS restaurant_hours_exceptions_times_check;
ALTER TABLE restaurant_hours_exceptions
  ADD CONSTRAINT restaurant_hours_exceptions_times_check
  CHECK (
    (is_closed AND opens_at IS NULL AND closes_at IS NULL)
    OR (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL)
  );

COMMENT ON TABLE restaurant_hours_exceptions IS
  '特定日の休業・時間変更。restaurant_opening_hours（曜日ごとの通常営業）を上書きする。';

-- 「今日」で引く（判定 SQL は当日と前日の 2 日ぶんを見る）。
CREATE INDEX IF NOT EXISTS idx_restaurant_hours_exceptions_date
  ON restaurant_hours_exceptions(restaurant_id, exception_date);

-- クライアントからの直接アクセスを塞ぐ。書き込みは API / パイプライン（service role）経由。
-- restaurant_links（20260828T0000）と同じ方針で、ポリシーは置かない。
ALTER TABLE restaurant_opening_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_hours_exceptions ENABLE ROW LEVEL SECURITY;

COMMIT;
