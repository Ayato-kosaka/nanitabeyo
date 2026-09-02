-- =============================================================================
-- restaurants に「その行を誰が作ったか」を刻む（#843 の上書き事故への止血）
-- =============================================================================
--
-- 【何が起きたか】
--
-- `restaurants` には書き手が2つある。
--
--   1. アプリ  : ユーザーが地図の POI を押すと POST /v1/restaurants が行を作る
--   2. パイプライン: 9_1_sync_restaurants.py が BigQuery の catalog を同期する
--
-- 9_1 の「表示値を上書きする UPDATE」は、上書きしてよい行かどうかを
-- `s.existing_restaurant_id IS NULL` で判定していた。この値が入るのは
-- **1_2 が撮ったスナップショットに載っていた行だけ**である。
--
--   1_2 がスナップショットを撮る
--     ↓ 2_1 〜 8_1（実測で約40時間）
--   9_1 が PostgreSQL へ書く
--
-- この間にアプリが作った行はスナップショットに載っていないため、9_1 は
-- 「新規行だ」と誤認して name / 座標 / image_url / image_path /
-- address_components / plus_code をオープンデータ値で上書きする。
-- 2026-08-24 の dev 同期で実際に7行が壊れた。
--
-- 【真因は「40時間」ではない】
--
-- 判定の根拠を **PostgreSQL の外にある、古いデータに対する否定条件** として
-- 書いたことが原因である。窓を4時間に縮めても事故は 1/10 になるだけで消えない。
-- 根拠を「行のとなりに置かれた、時間に依らない事実」へ移す。
--
-- 【この列の位置づけ】
--
-- `created_by_source` は **その行を誰が作ったかという不変の履歴**である。
-- 止血の段階ではこれを更新権の判定にも使うが、それは恒久的な設計ではない。
--
-- 行単位で更新権を固定すると、逆向きの問題が起きる。ユーザーが作った店は
-- パイプラインから一切更新されなくなり、閉店・改名が永久に届かない。
-- 本来は「店名はユーザーが直したので守る」「営業状態はパイプラインが常に書く」
-- のように **属性ごとに所有者が違う** べきで、そこへ向かう設計を別途進める。
-- その段階で `created_by_source` は更新権の判定から外れ、履歴の記録だけになる。
--
-- 【値】
--
--   user     : アプリ経由でユーザーの操作により作られた
--   owner    : 店舗オーナーが登録した（将来用。現在この値を書く経路は無い）
--   pipeline : restaurant_recommendation の同期が作った
--   manual   : 運用者が手で入れた
--
-- 「誰が作ったか」で名前を付けており、どの外部サービスから値を取ったかは
-- 表さない。出所は属性ごとに別途持つ（そちらが本来の設計）。
-- =============================================================================

BEGIN;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS created_by_source TEXT NOT NULL DEFAULT 'user';

ALTER TABLE restaurants
  DROP CONSTRAINT IF EXISTS restaurants_created_by_source_check;
ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_created_by_source_check
  CHECK (created_by_source IN ('user', 'owner', 'pipeline', 'manual'));

COMMENT ON COLUMN restaurants.created_by_source IS
  'その行を作った主体。user=アプリ経由のユーザー操作、owner=店舗オーナー、pipeline=restaurant_recommendation同期、manual=運用者。'
  '不変の履歴であり、既定は user。9_1 は pipeline の行だけを上書きする。';

-- 既定値 'user' は「アプリが作った行を守る」側に倒れる安全側の初期値である。
-- パイプラインが既に投入済みの行を pipeline へ倒す backfill は、対象の特定に
-- 同期ログ（restaurant_pg_sync_logs）と BigQuery 側の情報が要るため、
-- このマイグレーションには含めず専用スクリプトで行う。
-- backfill 前に 9_1 を流すと、パイプライン製の行が 'user' 扱いになり
-- **オープンデータの更新が一切反映されなくなる**（壊れはしないが止まる）。

CREATE INDEX IF NOT EXISTS idx_restaurants_created_by_source
  ON restaurants(created_by_source);

COMMIT;

-- rollback（必要時に手動実施）:
-- DROP INDEX IF EXISTS idx_restaurants_created_by_source;
-- ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_created_by_source_check;
-- ALTER TABLE restaurants DROP COLUMN created_by_source;
