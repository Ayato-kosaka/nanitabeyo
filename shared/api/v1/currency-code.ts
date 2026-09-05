import { IsString, Matches, ValidateIf } from "class-validator";

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

/**
 * #1774 **価格を入れるなら通貨も必ず入れる**ことを境界で強制する。
 *
 * `price_cents` は「最小単位の整数」であって、桁数は通貨ごとに違う（JPY は 0 桁、
 * USD は 2 桁）。つまり **通貨が分からない `price_cents` は、数として意味を持たない**。
 * それでも `currencyCode` を単独で `@IsOptional()` にしていたため、
 * 「価格はあるが通貨が無い行」を API が受け付けていた。
 *
 * 実害が出ている: dev の `dish_reviews` に残る `currency_code IS NULL` の 2 行は、
 * クライアントが通貨未確定のまま既定 2 桁で換算し、¥500 / ¥550 を 50,000 / 55,000 として
 * 送った残骸である（クライアント側は `toMinorAmountInteger()` が throw するよう塞いだが、
 * サーバは今も受け付ける）。表示側 (`formatReviewPrice`) は通貨が無い行を `null` にするので
 * **保存はされるが誰にも見えない**、という最悪の形で残る。
 *
 * ⚠️ 部分更新（PATCH）には使わない。あちらは「今回送らなかった項目は据え置き」なので、
 *    ボディだけを見ても «結果として通貨が付くか» が決まらない。更新後の状態で判定する
 *    （`DishReviewsService.updateDishReview`）。
 */
export function CurrencyCodeWithPrice(): PropertyDecorator {
	const gate = ValidateIf(
		(o: { priceCents?: number | null; currencyCode?: string | null }) =>
			(o.priceCents !== undefined && o.priceCents !== null) ||
			(o.currencyCode !== undefined && o.currencyCode !== null),
	);
	const isString = IsString({
		message: "currencyCode is required when priceCents is set",
	});
	const matches = Matches(CURRENCY_CODE_PATTERN, {
		message: "currencyCode must be a 3-letter currency code (e.g. JPY, USD)",
	});

	return (target: object, key: string | symbol) => {
		matches(target, key);
		isString(target, key);
		gate(target, key);
	};
}
