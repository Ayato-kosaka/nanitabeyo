/**
 * #1774 `restaurant × dish_category`（= `dishes` 行）の価格帯（price band）計算の正本。
 *
 * `dishes` は `@@unique([restaurant_id, category_id])` なので、`dish_id` でグルーピングすれば
 * それがそのまま `restaurant × dish_category` 単位になる（既存の `averageRating` / `reviewCount`
 * と同じ前提。`api/src/v1/dish-media/dish-media.repository.ts:948-975` 参照）。
 *
 * ## 通貨バグの残骸（#1700 で修正済み）
 *
 * PR #1700（commit `88278abc`、2026-08-30 08:53 UTC マージ）より前は、`address_components` が
 * 空のオープンデータ由来の店でレビューを投稿すると、通貨コードが引けず「1000円」が
 * `100000` として保存され、かつ `currency_code` は `undefined` のまま保存されていた。
 * この行を混ぜると中央値が最大100倍に壊れるため、`currencyCode === null` の行は
 * {@link computePriceBand} が呼び出し側のフィルタとは独立してもう一度必ず除外する。
 */

/** {@link computePriceBand} への入力1行。呼び出し側で deleted_at / 退会ユーザーは除外済みのものを渡すこと */
export type PriceBandReviewRow = {
	priceCents: number | null;
	currencyCode: string | null;
};

export type PriceBand = {
	minCents: number;
	maxCents: number;
	currencyCode: string;
};

/**
 * 通貨ごとの価格帯の刻み。Issue #1774 の PL 確定は円のみ。
 *
 * ⚠️ 他通貨の刻みは未確定のため、ここに無い通貨は {@link resolvePriceBand} が null を返す
 * （境界を決め打ちで丸めない）。UI 側で同じ刻みを使う際もこの定数を参照すること
 * （通貨ごとの刻みをここ以外にハードコードしない）。
 */
export const PRICE_BAND_STEPS_CENTS: Readonly<Record<string, readonly number[]>> = {
	JPY: [0, 500, 1000, 1500, 2000, 3000, 5000, 8000, 10000],
};

/** これ未満のレビュー件数では priceBand を返さない（1件で「この店のカレーは3000円」と出すのは誤情報） */
export const PRICE_BAND_MIN_REVIEW_COUNT = 3;

function median(sortedAsc: readonly number[]): number {
	const n = sortedAsc.length;
	const mid = Math.floor(n / 2);
	return n % 2 === 0 ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2 : sortedAsc[mid];
}

/**
 * 中央値を刻みへ丸めて価格帯を返す。刻み未定義の通貨は null。
 *
 * 最上位の刻み（円なら 10000〜）は上限が無いので、`maxCents` に `Number.MAX_SAFE_INTEGER` を
 * 入れる（「10000+」の open-ended な区間を表す）。
 */
export function resolvePriceBand(currencyCode: string, medianCents: number): PriceBand | null {
	const steps = PRICE_BAND_STEPS_CENTS[currencyCode];
	if (!steps || steps.length === 0) return null;

	let bucketIndex = 0;
	for (let i = 0; i < steps.length; i++) {
		if (medianCents >= steps[i]) bucketIndex = i;
		else break;
	}

	return {
		minCents: steps[bucketIndex],
		maxCents: bucketIndex + 1 < steps.length ? steps[bucketIndex + 1] : Number.MAX_SAFE_INTEGER,
		currencyCode,
	};
}

/**
 * dish_reviews の価格行から、その dish 1件ぶんの `priceBand` を決める。
 *
 * - `currencyCode === null` の行（通貨バグの残骸）は無条件で除外する
 * - 通貨が混ざるときは最もレビュー件数が多い通貨だけを採用し、他通貨は母数から除外する
 *   （為替換算はしない。件数が同数のときは通貨コードの昇順で決定的に選ぶ）
 * - 採用した通貨の件数が {@link PRICE_BAND_MIN_REVIEW_COUNT} 未満なら null
 * - 代表値は中央値（外れ値に強い。平均は1件の外れ値で大きく振れるため不採用）
 */
export function computePriceBand(rows: readonly PriceBandReviewRow[]): PriceBand | null {
	const byCurrency = new Map<string, number[]>();
	for (const row of rows) {
		// #1774 通貨バグの残骸。currency_code が無い行を混ぜると中央値が最大100倍に壊れる
		if (row.currencyCode === null || row.priceCents === null) continue;
		const list = byCurrency.get(row.currencyCode) ?? [];
		list.push(row.priceCents);
		byCurrency.set(row.currencyCode, list);
	}

	let topCurrency: string | null = null;
	let topPrices: number[] = [];
	for (const [currencyCode, prices] of Array.from(byCurrency.entries())) {
		const isMoreReviews = prices.length > topPrices.length;
		const isTieByEarlierCode =
			prices.length === topPrices.length && topCurrency !== null && currencyCode < topCurrency;
		if (isMoreReviews || isTieByEarlierCode) {
			topCurrency = currencyCode;
			topPrices = prices;
		}
	}

	if (topCurrency === null || topPrices.length < PRICE_BAND_MIN_REVIEW_COUNT) return null;

	const sorted = [...topPrices].sort((a, b) => a - b);
	return resolvePriceBand(topCurrency, median(sorted));
}
