-- ==============================================================================
-- 20260904T0000_add_restaurants_subterritory_code.sql
-- #1671 / #843
-- ==============================================================================
-- 【目的】
-- restaurants に「州・県コード（ISO 3166-2）」を持たせる。
-- **追加のみ（expand）**で、既存コードは 1 行も壊れない。削除は別 migration。
--
-- 【なぜ必要か】
--
-- #1671 の完了条件に「`google_place_id` は external ID として保持できる」がある。
-- これを満たすには、店の作成時に Google の `address_components` を保存するのを
-- やめる必要がある。ところが `address_components` は **料理の命名**に使われている。
--
--     api/src/v1/dishes/dishes.service.ts
--       // レストランの住所情報からローカル言語コードを推測
--       const languageCode = this.locationsService.resolveLocalLanguageCode(
--         restaurant.address_components as ...
--       );
--
-- `country_code`（20260828T0000 で追加済み）だけでは代替できない。
-- `resolveLocalLanguageCode` は国だけでなく **`administrative_area_level_1` から
-- ISO 3166-2 のサブ領域コード**も組み立てており（`locations.service.ts` の
-- `extractLocationCodes`）、そこで言語を切り替えているためである。
--
-- ⚠️ **country_code だけで代用すると、スイス・スペイン・ベルギーのように
-- 州で言語が変わる国で静かに壊れる。** 料理名が現地語で付かなくなるが、
-- 例外もエラーも出ないので気づけない。
--
-- この列を足して確認ページで埋めれば、`resolveLocalLanguageCode` を
-- 「列から読む」形へ寄せられ、`address_components` への依存を外せる。
--
-- 【なぜ country_code と別の列にするのか】
--
-- ISO 3166-2 は `CH-GE` のように «国コード + サブ領域» の連結だが、
-- **国だけ引けてサブ領域が引けない店が普通にある**（`administrative_area_level_1` が
-- 無い国・地域）。1 列に押し込むと「国は分かるがサブ領域は不明」を表現できない。
-- 既存の `extractLocationCodes` も 2 つを別々に返している。
--
-- 【NOT NULL にしない理由】
--
-- `country_code` と同じ。引けない店が実在する（20260828T0000 の
-- 「南オセチア・ツヒンヴァリの店」の記述を参照）。サブ領域はさらに欠けやすい。
-- 引けないときは NULL のままにし、呼び出し側は従来どおり国だけで解決する。
--
-- 【既存データへの影響】
-- NULL 許容の列追加のみ。既存行は書き換わらない（テーブル rewrite 無し）。
-- 値を入れるのは #1671 の確認ページ経由（Google は追加で叩かない。確認ページが
-- 既に持っている値から入れる）。
--
-- 【ロールバック】
--   ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_subterritory_code_check;
--   ALTER TABLE restaurants DROP COLUMN IF EXISTS subterritory_code;
-- ==============================================================================

BEGIN;

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS subterritory_code TEXT;

COMMENT ON COLUMN restaurants.subterritory_code IS
  'ISO 3166-2 の州・県コード（例: CH-GE, ES-CT）。現地言語の解決に使う。'
  '国は引けてもサブ領域が引けない店があるため NULL 許容。'
  'country_code と別列にしているのは「国は分かるがサブ領域は不明」を表現するため。';

-- ISO 3166-2 は「国コード 2 文字 + ハイフン + 1〜3 文字の英数字」。
-- ⚠️ 形だけを見る。実在するコードかどうかまでは DB では判定しない
--    （国ごとの一覧を DB に持つ運用コストに見合わない）。
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_subterritory_code_check;
ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_subterritory_code_check
  CHECK (subterritory_code IS NULL OR subterritory_code ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$');

-- ⚠️ 索引は付けない。この列は「その店の言語を決める」ために **1 行を読むとき**にしか
--    使わず、検索条件にはならない。使われない索引は書き込みを遅くするだけである。

COMMIT;
