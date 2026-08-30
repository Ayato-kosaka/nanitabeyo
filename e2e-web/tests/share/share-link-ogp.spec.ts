import { test, expect } from "../../fixtures/test";
import { createShareLinkViaApi, fetchSharePage, SHARE_CRAWLER_USER_AGENTS } from "../../utils/shareLinks";

/**
 * 🔗 共有リンク `/s/:token` の OGP（#721）@mutation
 *
 * ## なぜ E2E で守るのか
 * #721 の目的は「SNS の共有カードに **投稿ごとの** タイトルとサムネイルを出す」こと。
 * これは **JS を実行しない相手（クローラ）に対して、初回レスポンスの HTML が何を含むか**
 * という性質なので、ユニットテストでは «HTML を組み立てる関数» までしか守れない。
 * 実際に配信して初めて分かるのは次の 2 つで、どちらも過去に事故っている形。
 *
 * 1. ルーティングが本当にこの HTML を返すか
 *    → #281 で `/sitemap.xml` が catch-all に落ちて index.html を **200 で** 返していた
 * 2. Interceptor が HTML を JSON へ包んでいないか
 *    → `@SkipResponseWrap()` を外すと `{ success, data }` になり OGP が 1 つも読めない
 *
 * ## API を直接叩く理由（Firebase 経由にしない）
 * `firebase.json` の `serviceId` はリテラルしか書けず、development の preview チャンネルからも
 * `api-production` を向く。つまり **preview URL 経由では dev の共有リンクを開けない**。
 * ここで見たいのは「API が返す HTML」なので、`EXPO_PUBLIC_BACKEND_BASE_URL` へ直接当てる。
 * rewrite の «順序» は別途 `app-expo/__tests__/firebaseShareRewrite.test.ts` が固定している。
 *
 * ## @mutation の理由
 * 共有リンクの作成は dev DB へ 1 行 INSERT する。読み取り専用ではない。
 */
test.describe("共有リンクの OGP(#721) @mutation", () => {
	// ─ テストケース: JS 無しで投稿固有の OGP が読める ─
	// 手順:
	//   1. 実際に存在する dish_media を 1 件拾う（検索結果の API から取る）
	//   2. POST /v1/share-links で共有リンクを作る
	//   3. その `/s/:token` を **素の HTTP GET** で取る（ブラウザを介さない＝ JS を実行しない）
	//   4. og:title / og:image / og:url / twitter:card が入っていることを検証
	test("JS を実行しなくても og:title と og:image が入っている", async ({ appPage, request }) => {
		const { token, url, dishMediaId } = await createShareLinkViaApi(appPage, request);

		const { status, body, contentType } = await fetchSharePage(request, token);

		expect(status, "共有ページが 200 で返ること").toBe(200);
		// ⚠️ ここが #281 と同型の検知点。catch-all に落ちると text/html だが index.html が返る
		expect(contentType).toContain("text/html");

		// Interceptor が包んでいたら HTML ではなく JSON になる
		expect(body.startsWith("<!doctype html>")).toBe(true);
		expect(body).not.toContain('"success"');

		// 投稿固有であること。既定 OGP のままなら #721 は達成できていない
		expect(body).toMatch(/<meta property="og:title" content="[^"]+">/);
		expect(body).toContain('<meta property="og:type" content="article">');
		expect(body).toContain(`<meta property="og:url" content="${url}">`);
		expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');

		// og:image は「不変の URL」でなければならない。署名 URL を直接書くと 24 時間で失効し、
		// SNS の再クロール時に画像だけ消える
		expect(body).toContain(`<meta property="og:image" content="${url}/og-image">`);
		expect(body).not.toMatch(/og:image" content="[^"]*[?&](Expires|X-Goog-Expires)=/);

		expect(dishMediaId).toBeTruthy();
	});

	// ─ テストケース: クローラと人間で同じ HTML を返す ─
	// 手順:
	//   1. 共有リンクを作る
	//   2. facebookexternalhit / Twitterbot / 通常ブラウザの 3 つの UA で同じ URL を取る
	//   3. 3 つの本文が完全一致することを検証
	//
	// Dynamic Rendering（UA でクローラにだけ別 HTML を返す）を採らない、という設計判断を固定する。
	// UA 分岐が入ると cloaking と区別できず、検索・SNS 双方でペナルティのリスクがある
	test("crawler UA と browser UA で完全に同じ HTML を返す", async ({ appPage, request }) => {
		const { token } = await createShareLinkViaApi(appPage, request);

		const bodies = await Promise.all(
			SHARE_CRAWLER_USER_AGENTS.map(async (userAgent) => {
				const response = await fetchSharePage(request, token, userAgent);
				expect(response.status).toBe(200);
				return response.body;
			}),
		);

		for (const body of bodies) {
			expect(body).toBe(bodies[0]);
		}
	});

	// ─ テストケース: 人間はブラウザで対象ページへ自動遷移する（#1194）─
	// 手順:
	//   1. 共有リンクを作る
	//   2. **実ブラウザで** /s/:token を開く
	//   3. 中間画面に留まらず、対象ページ（/{locale}/posts?ids=...）へ着いていることを検証
	//
	// 遷移先には既に OpenInAppBanner があるので、中間画面で「アプリで開く」を再掲するのは
	// 重複だった（実機フィードバック）。ここは request ではなく **page** で見ること。
	// 生の HTTP で取ると script が走らないので、この振る舞いは観測できない。
	test("人間は中間画面に留まらず対象ページへ着く", async ({ appPage, request }) => {
		const { token } = await createShareLinkViaApi(appPage, request);

		await appPage.goto(`/s/${token}`);

		// 中間画面（/s/...）に留まっていないこと
		await expect(appPage).not.toHaveURL(new RegExp(`/s/${token}$`), { timeout: 30_000 });
		// 対象ページ（投稿一覧）へ着いていること
		await expect(appPage).toHaveURL(/\/posts\?ids=/, { timeout: 30_000 });
	});

	// ─ テストケース: og:image が実際に取得できる ─
	// 手順:
	//   1. 共有リンクを作る
	//   2. `/s/:token/og-image` を **リダイレクトを追わずに** 取る
	//   3. 302 であること、Location が署名済みの実体を指すことを検証
	//
	// ここを 200 で返す実装（画像を proxy する）へ変えると、Cloud Run が画像帯域を負担する。
	// 302 に留めているのは意図的な設計判断なので、ステータスまで固定する
	test("og:image は 302 で実体へ飛ばす（Cloud Run が画像を中継しない）", async ({ appPage, request }) => {
		const { token } = await createShareLinkViaApi(appPage, request);

		const response = await request.get(`${apiBase()}/s/${token}/og-image`, {
			maxRedirects: 0,
			failOnStatusCode: false,
		});

		expect(response.status()).toBe(302);
		const location = response.headers()["location"];
		expect(location, "Location ヘッダが無い").toBeTruthy();
		expect(location.startsWith("http")).toBe(true);
	});

	// ─ テストケース: 存在しない token は 404 ─
	// 手順:
	//   1. 形は正しいが存在しない token で `/s/:token` を取る
	//   2. 404 であることを検証（index.html の 200 に落ちていないこと）
	test("存在しない token は 404（index.html の 200 に落ちない）", async ({ request }) => {
		const { status, body } = await fetchSharePage(request, "s1_0123456789abcdefghijkl");

		expect(status).toBe(404);
		// catch-all に落ちていれば 200 で index.html が返る。404 であること自体が検知点
		expect(body).not.toContain('<meta property="og:type" content="article">');
	});
});

/** API のベース URL（ビルド時に app へ焼き込まれるものと同じ） */
function apiBase(): string {
	const base = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
	if (!base) {
		throw new Error(
			"EXPO_PUBLIC_BACKEND_BASE_URL が未設定です。e2e-web/.env に設定するか、eas-cli env:pull を実行してください。",
		);
	}
	return base.replace(/\/+$/, "");
}
