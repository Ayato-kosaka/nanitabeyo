import type { Page, Route } from "@playwright/test";

/**
 * 📈 表示ログ / 視聴ログ（`POST /v1/dish-media/<id>/impression` と `.../view`）を握るスタブ。
 *
 * Feed は描いたメディアごとにこの 2 本を投げる。spec が組む架空のメディア id
 *（`media-ramen` / `e2e-1122-dish-media-*` など）は実 API に存在しないので、
 * 素通しすると **400 が返り**、ブラウザがそれを console error として出して REL-08 が落とす。
 *
 * ⚠️ **204 + 空ボディで握らないこと。** それをやると今度は `useAPICall` が
 * `response.json()` に失敗して `invalid_response` を throw する。#1785 まで両 spec が
 * そうなっていて、`[pageerror] Object` が残り続けていた（`ApiError` は Error では
 * ないので stack が無く、失敗ログには «Object» としか出ない）。
 * **実 API と同じ封筒（`{ success, data }`）を 200 で返す**のが正しい握り方である。
 *
 * ⚠️ **impression だけを握らないこと。** 視聴ログ（`/view`）は非アクティブ化・unmount で
 * 後から飛ぶので、書いた本人の目には «押した直後» に見えない。#1785 ではこれが
 * 抜けていて、`/v1/dish-media/<id>/view` の 400 だけが残っていた。
 *
 * 記録が届いたかどうかを検証したい spec は、これを使わず自前で握って中身を見ること。
 * ここが受け持つのは «記録の成否はこの spec の関心ではない» 場合だけである。
 */
export async function stubDishMediaTracking(page: Page): Promise<void> {
	await page.route(
		(url: URL) => /\/v1\/dish-media\/[^/]+\/(impression|view)$/.test(url.pathname),
		async (route: Route) => {
			const origin = (await route.request().headerValue("origin")) ?? "*";
			const cors = {
				"access-control-allow-origin": origin,
				"access-control-allow-credentials": "true",
				"access-control-allow-headers": "authorization,content-type,x-client-info,apikey",
				"access-control-allow-methods": "GET,POST,OPTIONS",
			};
			if (route.request().method() === "OPTIONS") {
				await route.fulfill({ status: 204, headers: cors, body: "" });
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: cors,
				body: JSON.stringify({ success: true, data: null }),
			});
		},
	);
}
