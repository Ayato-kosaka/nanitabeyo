import type { Page, Route } from "@playwright/test";

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
