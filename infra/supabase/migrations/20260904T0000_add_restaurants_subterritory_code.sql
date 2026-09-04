-- ==============================================================================
-- 20260904T0000_add_restaurants_subterritory_code.sql
-- #1671 / #843
-- ==============================================================================
-- 【目的】
-- restaurants に「州・県の識別子」を持たせる。
-- ⚠️ ISO 3166-2 «風» だが ISO そのものではない（末尾の CHECK のコメントを参照）。
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
-- サブ領域の識別子**も組み立てており（`locations.service.ts` の
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
-- この識別子は `CH-GE` のように «国コード + サブ領域» の連結だが、
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
  '州・県の識別子。現地言語の解決に使う。'
  '⚠️ ISO 3166-2 とは限らない。値は「国コード + ハイフン + Google の '
  'administrative_area_level_1.shortText」で、日本では JP-Oita のような英語名になる。'
  '国は引けてもサブ領域が引けない店があるため NULL 許容。'
  'country_code と別列にしているのは「国は分かるがサブ領域は不明」を表現するため。';

-- ⚠️ **ISO 3166-2 の «形» を DB で要求してはいけない。**
--
-- この列を作る唯一の生成元は locations.service.ts の extractLocationCodes で、
-- そこは Google の administrative_area_level_1.shortText をそのまま連結している。
--
--     subterritoryCode = `${countryCode}-${adminLevel1Component.shortText}`
--
-- Google の shortText は日本では ISO コードではなく **都道府県の英語名**である
-- （locations.service.spec.ts の実データ写し: shortText: 'Oita'）。つまり実際に
-- 入る値は JP-Oita / JP-Kyoto であって、JP-44 ではない。
-- `^[A-Z]{2}-[A-Z0-9]{1,3}$` を課すと、**日本の店では列を埋めた瞬間に
-- 23514 check_violation で 500 になる**。
--
-- 「Oita → JP-44」へ直すには国ごとの ISO 一覧が要るが、それは運用コストに
-- 見合わないと判断した（見合うようになったら、そのとき対応表ごと入れる）。
-- 値は subterritory_overrides.json との **完全一致引き**にしか使われず、
-- 一致しなければ国レベルの言語へ落ちるだけなので、形が ISO でなくても壊れない。
--
-- したがって DB が守るのは「壊れた長さのものを入れない」ことだけにする。
-- 形の検証は DTO 側（country_code の @Length(2, 2) と同じ場所）に置く。
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_subterritory_code_check;
ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_subterritory_code_check
  CHECK (subterritory_code IS NULL OR length(subterritory_code) BETWEEN 3 AND 32);

-- ⚠️ 索引は付けない。この列は「その店の言語を決める」ために **1 行を読むとき**にしか
--    使わず、検索条件にはならない。使われない索引は書き込みを遅くするだけである。

COMMIT;
