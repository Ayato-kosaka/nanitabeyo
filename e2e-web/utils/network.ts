import type { BrowserContext, Page, Route } from "@playwright/test";

/**
 * 🌐 ネットワーク観測ユーティリティ
 *
 * 「連打しても API が 1 回しか飛ばない」のように **リクエストの回数**を検証するために使う。
 */

/** `countRequests` が返すカウンタ */
export type RequestCounter = {
	/** これまでに観測したリクエスト件数 */
	count(): number;
	/** 計測を終了しルーティングを解除する */
	stop(): Promise<void>;
};

/** `countRequests` の絞り込みオプション */
export type CountRequestsOptions = {
	/**
	 * 数える HTTP メソッド(大文字小文字は問わない)。未指定ならメソッドを問わず数える。
	 *
	 * 同じパスに GET と POST の両方がある場合(例: `v1/dishes`)、書き込みの回数だけを
	 * 見たいときに指定する。CORS プリフライト(OPTIONS)は Playwright の route に載らないため
	 * 考慮不要。
	 */
	method?: string;
};

/**
 * URL パターンに一致するリクエストを **素通しのまま**数える。
 *
 * ⚠️ `route.fulfill()` / `route.abort()` は使わないこと(#1084 設計 §3-1)。
 * - `abort()`: app-expo/hooks/useAPICall.ts は GET をネットワークエラー時に 1 回自動リトライするため、
 *   件数が 1 → 2 に膨らんで期待値が書けなくなる
 * - `fulfill()`: バックエンドは別オリジン(Cloud Run)のため CORS プリフライトを自前で面倒見る必要があり、
 *   さらに空配列を返すと features/topics/hooks/useTopicSearch.ts の再検索に引っかかって件数が膨らむ
 *
 * @param page 対象ページ
 * @param urlGlob 計測対象の URL パターン(Playwright の glob)
 * @param options メソッド絞り込み等のオプション
 */
export async function countRequests(
	page: Page,
	urlGlob: string,
	options: CountRequestsOptions = {},
): Promise<RequestCounter> {
	let count = 0;
	const method = options.method?.toUpperCase();

	const handler = async (route: Route): Promise<void> => {
		if (!method || route.request().method().toUpperCase() === method) {
			count += 1;
		}
		await route.continue();
	};
	await page.route(urlGlob, handler);

	return {
		count: () => count,
		stop: () => page.unroute(urlGlob, handler),
	};
}

/**
 * 料理メディアの検索結果を **常に 0 件**に固定する（#828 の Google マップ fallback 到達用）。
 *
 * 実 API で「必ず 0 件になる検索条件」を用意することはできないため、0 件判定に使う
 * 2 エンドポイントだけを空配列に差し替える。トピック提案までは実 API のまま動く。
 * - `v1/dish-media/search` (GET) : 既存 dish_media の検索。0 件だと import へ進む
 * - `v1/dishes/bulk-import` (POST): 店舗候補の初回取り込み。ここも 0 件で 0 件確定
 *   （**差し替えにより dev DB への書き込みは発生しない**ので `@mutation` は不要）
 *
 * ⚠️ CORS: バックエンドは別オリジン (Cloud Run) なので、fulfill するレスポンスにも
 * CORS ヘッダが要る。`app-expo/lib/fetchWithAuth.ts` は web で `credentials: "include"` を
 * 使うため、`access-control-allow-origin: *` は**使えない**。リクエスト元 origin を
 * そのまま返し `access-control-allow-credentials` を付ける。
 * プリフライト (OPTIONS) は route に載らず実サーバへ出るが、dev の CORS_ORIGIN に
 * ローカルサーバのオリジンが登録済みのため通る。
 *
 * @param context ルートを仕掛ける BrowserContext（ポップアップにも効かせるため page ではなく context）
 */
export async function stubEmptyDishMediaResults(context: BrowserContext): Promise<void> {
	const fulfillEmptyList = async (route: Route): Promise<void> => {
		const origin = (await route.request().headerValue("origin")) ?? "*";
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: {
				"access-control-allow-origin": origin,
				"access-control-allow-credentials": "true",
			},
			body: "[]",
		});
	};

	await context.route("**/v1/dish-media/search*", fulfillEmptyList);
	await context.route("**/v1/dishes/bulk-import*", fulfillEmptyList);
}

/**
 * `https://www.google.com/**` をスタブ HTML に差し替え、**実 Google への通信を遮断**する。
 *
 * 別タブが開いたことと、その URL さえ分かれば十分なので Google Maps 本体は読み込ませない。
 * `route.abort()` ではなく `fulfill()` にしているのは、ナビゲーションが commit されないと
 * 新しいタブの URL が `about:blank` のままになりうるため。
 */
export async function stubGoogleMaps(context: BrowserContext): Promise<void> {
	await context.route("https://www.google.com/**", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "text/html",
			body: "<html><body>stubbed google maps</body></html>",
		});
	});
}
