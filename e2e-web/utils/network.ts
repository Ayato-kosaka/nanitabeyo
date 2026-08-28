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
 *   さらに空配列を返すと features/dishCategories/hooks/useDishCategorySearch.ts の再検索に引っかかって件数が膨らむ
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

/**
 * 料理提案(トピック)取得 API を常に 500 で固定し、DishCategories 画面を取得失敗状態にする(#1499)。
 *
 * `v1/dish-categories/recommendations` は GET だが、`app-expo/hooks/useAPICall.ts` の
 * 自動リトライはネットワーク到達不能時と 401/503 だけが対象で、500 はそのまま
 * `http_error` として即座に throw されるため、1 回のクリックにつき 1 リクエストで確定する
 * (`countRequests` の JSDoc にある 503/network エラーの自動リトライとは別枠)。
 *
 * ルートは `unroute` するまで生存し続けるため、再試行ボタンを押しても同じ 500 を返し続け、
 * 「再試行しても失敗する」ケースの固定に使える。
 *
 * CORS の扱いは {@link stubEmptyDishMediaResults} と同じ理由でリクエスト元 origin を返す。
 *
 * @param context ルートを仕掛ける BrowserContext
 * @param options.delayMs レスポンスを返すまでの遅延(ms)。既定 0。
 *   再試行ボタンが `isRetrying` 中に非活性(disabled)であることを検証したいテストのように、
 *   「リクエストが飛んでからレスポンスが返るまでの間」を観測したい場合に指定する。
 * @returns 仕掛けたリクエスト数を数えられるカウンタと、ルートを解除する関数
 */
export async function stubDishCategoryRecommendationsFailure(
	context: BrowserContext,
	options: { delayMs?: number } = {},
): Promise<RequestCounter> {
	let count = 0;
	const urlGlob = "**/v1/dish-categories/recommendations*";
	const delayMs = options.delayMs ?? 0;

	const handler = async (route: Route): Promise<void> => {
		count += 1;
		if (delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		const origin = (await route.request().headerValue("origin")) ?? "*";
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			headers: {
				"access-control-allow-origin": origin,
				"access-control-allow-credentials": "true",
			},
			body: JSON.stringify({ success: false, message: "stubbed failure (#1499)" }),
		});
	};

	await context.route(urlGlob, handler);

	return {
		count: () => count,
		stop: () => context.unroute(urlGlob, handler),
	};
}

/** `stubSavedDishCategories` へ渡す料理カテゴリ1件分の最小形 */
export type StubbedDishCategory = {
	id: string;
	label_en: string;
	/** ロケール先頭2文字（"ja" 等）をキーにした表示名。無いロケールは label_en へフォールバックする */
	labels: Record<string, string>;
	image_url: string;
};

/**
 * 「保存した料理カテゴリ」の一覧を固定のスタブへ差し替える（#1133）。
 *
 * マイページの保存料理カテゴリタブは実行アカウントの保存状況に依存するため、
 * 実 API のままだと **0 件のこともあり** カードを押せない
 * （= 地点検索モーダルを開く導線が無くなり、テストが環境依存で落ちる）。
 * このテストが見たいのはモーダルの中身であってカテゴリ一覧の取得ではないので、
 * 入口となる一覧だけを固定する。地点検索（autocomplete / details）は実 API のまま。
 *
 * ⚠️ 保存操作（POST）でデータを作る方式は採らない。dev DB へ書き込みが残るうえ、
 * 保存済みだった場合に解除されるなど、テスト間で状態が干渉する。
 *
 * CORS の扱いは {@link stubEmptyDishMediaResults} と同じ理由でリクエスト元 origin を返す。
 *
 * @param context ルートを仕掛ける BrowserContext
 * @param categories 一覧に出したい料理カテゴリ（新しい順）
 */
export async function stubSavedDishCategories(
	context: BrowserContext,
	categories: StubbedDishCategory[],
): Promise<void> {
	await context.route("**/v1/users/me/saved-dish-categories*", async (route: Route) => {
		const origin = (await route.request().headerValue("origin")) ?? "*";
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: {
				"access-control-allow-origin": origin,
				"access-control-allow-credentials": "true",
			},
			// useAPICall は BaseResponse の `data` だけを返すので、ページング形式を二重に包む
			body: JSON.stringify({ success: true, data: { data: categories, nextCursor: null } }),
		});
	});
}
