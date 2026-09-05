/**
 * #1273 «最後の受け皿は必ず埋まっている» という思い込みを二度と戻さないための固定。
 *
 * 固定するのは個別の画面ではなく **パターン**である:
 * ««無い» を空文字で表す NOT NULL の列を `??` で繋ぐと、空文字が «見つかった» として
 * 先へ通り、次の候補があっても落ちない»。
 *
 * 実測（dev / 2026-09-05。`scripts/db-checks/measure_delivered_but_invisible.py`）:
 * usable な dish_media 145,392 行のうち 3,119 行（2.15%）が 3 段とも空だった。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { firstNonEmptyUrl, nonEmptyUrl } from "../imageFallback";

test("空文字は «無い»（null）として扱う — ここが `??` との違い", () => {
	assert.equal(nonEmptyUrl(""), null);
});

test("空白だけの文字列も «無い»", () => {
	assert.equal(nonEmptyUrl("   "), null);
	assert.equal(nonEmptyUrl("\n\t"), null);
});

test("null / undefined は «無い»", () => {
	assert.equal(nonEmptyUrl(null), null);
	assert.equal(nonEmptyUrl(undefined), null);
});

test("値があれば前後の空白を落として返す", () => {
	assert.equal(nonEmptyUrl(" https://cdn/ramen.jpg "), "https://cdn/ramen.jpg");
});

test("空文字の候補を飛ばして次へ落ちる（`??` はここで止まっていた）", () => {
	assert.equal(firstNonEmptyUrl(null, "", "https://cdn/restaurant.jpg"), "https://cdn/restaurant.jpg");
});

test("先頭から見て最初の «空でない» を採る", () => {
	assert.equal(
		firstNonEmptyUrl("https://cdn/stored.jpg", "https://cdn/provider.jpg"),
		"https://cdn/stored.jpg",
	);
});

test("全部空なら空文字ではなく null を返す（呼び出し側が null 判定 1 つで済むように）", () => {
	assert.equal(firstNonEmptyUrl("", null, undefined, "  "), null);
	assert.equal(firstNonEmptyUrl(), null);
});
