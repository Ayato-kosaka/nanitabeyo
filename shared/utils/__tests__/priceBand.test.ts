/**
 * #1774 `computePriceBand` / `resolvePriceBand` の仕様固定テスト。
 *
 * PL 確定ルール（Issue #1774 コメント §4）をそのまま固定する。
 * - 代表値は中央値で、外れ値に引っ張られないこと
 * - 3件未満は null
 * - `currencyCode: null`（通貨バグの残骸）は母数に入らないこと
 * - 通貨が混ざったら最多通貨だけで集計すること
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { computePriceBand, resolvePriceBand, type PriceBandReviewRow } from "../priceBand";

const jpy = (priceCents: number): PriceBandReviewRow => ({ priceCents, currencyCode: "JPY" });

test("中央値が外れ値に引っ張られない（800/900/1000/1100/50000 → 1000円台）", () => {
	const rows = [800, 900, 1000, 1100, 50000].map(jpy);
	const band = computePriceBand(rows);
	// #1774 中央値は 1000。1000 は刻み [1000, 1500) の区間に丸まる
	assert.deepEqual(band, { minCents: 1000, maxCents: 1500, currencyCode: "JPY" });
});

test("2件しか無いとき null を返す", () => {
	const rows = [1000, 1100].map(jpy);
	assert.equal(computePriceBand(rows), null);
});

test("3件あれば priceBand を返す（最低件数の境界）", () => {
	const rows = [1000, 1000, 1000].map(jpy);
	assert.notEqual(computePriceBand(rows), null);
});

test("currency_code が null の行は母数に入らない（通貨バグの残骸）", () => {
	// 有効な JPY は 2 件しか無いので、null 混入分を数えなければ本来 null のはず
	const rows: PriceBandReviewRow[] = [
		jpy(1000),
		jpy(1100),
		// 通貨バグ由来: 1000円のつもりが100000として保存され currency_code は null
		{ priceCents: 100000, currencyCode: null },
	];
	assert.equal(
		computePriceBand(rows),
		null,
		"currency_code IS NULL の行を母数に数えるとレビュー3件扱いになり、この assertion が壊れる",
	);
});

test("通貨が混ざったら最多通貨だけで集計する（為替換算はしない）", () => {
	const rows: PriceBandReviewRow[] = [
		...Array.from({ length: 8 }, () => jpy(1000)),
		{ priceCents: 30, currencyCode: "USD" },
		{ priceCents: 30, currencyCode: "USD" },
	];
	// USD 2件は無視され、JPY 8件（中央値1000）だけで判定される
	assert.deepEqual(computePriceBand(rows), { minCents: 1000, maxCents: 1500, currencyCode: "JPY" });
});

test("最多通貨に刻みが定義されていなければ null（境界を決め打ちで丸めない）", () => {
	const rows: PriceBandReviewRow[] = Array.from({ length: 5 }, () => ({ priceCents: 3000, currencyCode: "USD" }));
	assert.equal(computePriceBand(rows), null);
});

test("resolvePriceBand: 中央値を含む区間へ丸める", () => {
	assert.deepEqual(resolvePriceBand("JPY", 0), { minCents: 0, maxCents: 500, currencyCode: "JPY" });
	assert.deepEqual(resolvePriceBand("JPY", 499), { minCents: 0, maxCents: 500, currencyCode: "JPY" });
	assert.deepEqual(resolvePriceBand("JPY", 500), { minCents: 500, maxCents: 1000, currencyCode: "JPY" });
});

test("resolvePriceBand: 最上位の刻み（10000+）は上限を持たない（maxCents: null）", () => {
	const band = resolvePriceBand("JPY", 15000);
	assert.deepEqual(band, { minCents: 10000, maxCents: null, currencyCode: "JPY" });
});

test("resolvePriceBand: 刻みが未定義の通貨は null", () => {
	assert.equal(resolvePriceBand("USD", 1000), null);
});
