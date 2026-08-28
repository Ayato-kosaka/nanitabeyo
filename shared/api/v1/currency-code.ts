/**
 * #1599 通貨コードの «形» の正本。
 *
 * DB 側は `currency_code CHAR(3)`。ここを緩くすると、4 文字以上で Postgres が
 * `value too long for type character(3)` を投げて **400 ではなく 500** になり、
 * 3 文字未満は空白で右詰めされて黙って保存される。
 *
 * ⚠️ **通貨コードの «一覧» はここで持たない。** class-validator の
 * `@IsISO4217CurrencyCode()` を使わないのも同じ理由で、あちらの一覧は古く、
 * アプリ自身が送りうる `ZWG`（ジンバブエ・ゴールド、2024 年導入）を弾いてしまう。
 * どの通貨を扱うかの正本は `app-expo/lib/googlePlaces.ts` の
 * `COUNTRY_TO_CURRENCY_MAP` であり、一覧を 2 箇所に置けば必ずずれる。
 */
export const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;
