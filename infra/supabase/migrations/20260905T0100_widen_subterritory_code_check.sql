-- ==============================================================================
-- 20260905T0100_widen_subterritory_code_check.sql
-- #1671 / #843
-- ==============================================================================
-- 【目的】
-- 20260904T0000 で私が入れた CHECK の上限 32 に **余裕が 1 文字も無い**ことが
-- 実データで分かったので広げる。
--
-- 【実測（dev / 2026-09-05 / run 33969817589）】
--
--   subterritory_code に入る値の最大長 : **32 文字**（上限そのもの）
--   32 文字を超える行                  : 0 件
--
--   最長の実例:
--     GE-აჭარის ავტონომიური რესპუბლიკა   （ジョージア・アジャリア自治共和国）
--
-- 【なぜ 32 では駄目なのか】
--
-- ⚠️ **いま 0 件なのは «収まっている» のであって «収まる» ではない。**
--
-- 値は `${countryCode}-${administrative_area_level_1.shortText}` で、shortText は
-- **保存時の languageCode でローカライズされた名前**が入る（当初 JP-Tokyo のような
-- 英語の短縮形だと思っていたが、実データは JP-東京都 だった）。したがって長さは
-- **国と言語の組み合わせ次第**で、こちらが制御できない。
--
-- 上限 32 は 20260904T0000 を書いたときに «だいたいで» 決めた値で、実データで
-- 確かめていなかった。たまたま最長がちょうど 32 だっただけであり、
-- **もう 1 文字長い州名の店が 1 件でも来れば、その店を確認ページから保存した
-- 瞬間に 23514 check_violation で 500 になる**。
--
-- ⚠️ これは 20260904T0000 で «ISO の形を実データで確かめずに正規表現で縛っていた»
--    のを直したときと **同じ間違い**である。形を長さへ替えただけで、
--    «実データで境界を確かめる» をやっていなかった。
--
-- 【なぜ 100 なのか】
--
-- 実測の最大 32 に対して 3 倍の余裕。DB の CHECK に期待する役割は
-- «壊れた長さのものを入れない» ことだけで（形の検証は DTO 側の責務）、
-- 100 文字を超える州名は現実には無く、それを超えたら実際に異常である。
--
-- 【既存データへの影響】
-- 制約の張り替えのみ。行は 1 行も書き換わらない。
-- 既存の 0 行（subterritory_code はまだ全行 NULL）も影響を受けない。
--
-- 【ロールバック】
--   ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_subterritory_code_check;
--   ALTER TABLE restaurants
--     ADD CONSTRAINT restaurants_subterritory_code_check
--     CHECK (subterritory_code IS NULL OR length(subterritory_code) BETWEEN 3 AND 32);
-- ==============================================================================

BEGIN;

ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_subterritory_code_check;

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_subterritory_code_check
  CHECK (subterritory_code IS NULL OR length(subterritory_code) BETWEEN 3 AND 100);

COMMIT;
