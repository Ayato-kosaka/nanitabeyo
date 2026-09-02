import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { DEEP_LINK_SMOKE_ROUTES } from "@app-expo/lib/seo/publicRoutes";

/**
 * 🔗 ディープリンクスモークテスト @smoke
 *
 * 目的:
 *   1. ローカル静的サーバ(scripts/serve-dist.mjs)が本番 Firebase Hosting と同じ rewrite 挙動で
 *      配信できていること = 「URL 直アクセス」がどの画面でも成立すること
 *   2. #1503 (REL-01) の再発防止。**prerender された HTML に画面の中身が入っていること**と、
 *      **直リンクで開いた画面が実際に描画されること**の両方を、公開ルート全件で見る
 *
 * ## なぜ配列を回すのか
 * 以前はここに「マイページ」「検索画面」の 2 本を手で書いていた。REL-01 では公開 4 ルート
 * すべてが白画面だったのに、この spec は 2 本しか無く、しかもどちらも
 * 「LoadScript が読み込みを終えた後の姿」しか見ていなかったので気づけなかった。
 * ルートの一覧は `app-expo/lib/seo/publicRoutes.ts` の 1 箇所にあり、
 * **ルートを足す人はそこへ 1 行足すだけ**でこの spec の本数が増える。
 * 足し忘れは `app-expo/__tests__/publicRoutes.test.ts` が落とす。
 *
 * ## console error の検知について
 * 新しく作っていない。#1500 (PR #1512) で `fixtures/test.ts` の `consoleErrors` auto フィクスチャが
 * **既定の失敗条件**になっているので、この spec が `fixtures/test` から `test` を import している
 * 限り、hydration 失敗（React error #418 等）や未捕捉例外は自動で赤くなる。
 * だから個々のテストに console のアサーションを書かない。
 */

/** テスト対象のロケール。全 8 ロケールを回すと本数が 8 倍になるため、実体の翻訳がある ja-JP を代表にする */
const LOCALE = "ja-JP";

/**
 * ルートごとの「描画されたと言える印」。
 *
 * 既定はタブバー（全タブ画面に出る共通マーカー）。タブの外にある画面や、
 * 画面固有の中身まで見たいものだけをここへ書く。
 * **新しいルートを足すとき、ここへの追記は必須ではない**（既定で回る）。
 */
const ROUTE_MARKERS: Record<string, (page: Page) => Promise<void>> = {
	search: async (page) => {
		await expect(page.getByTestId("search-header-title")).toBeVisible();
	},
	// #1375 レビュータブは «食べたい/食べた»（my-dishes）タブへ置き換わった。
	// 未ログインではゲスト説明が出る（ログイン後の 3 ビューは tests/authenticated/ が持つ）
	"my-dishes": async (page) => {
		await expect(page.getByTestId("my-dishes-guest-description")).toBeVisible();
	},
	profile: async (page) => {
		await expect(page.getByTestId("profile-login-button")).toBeVisible();
	},
	notifications: async (page) => {
		await expect(page.getByTestId("notifications-header-title")).toBeVisible();
	},
};

/** 法務ページ（`legal/*`）はタブの外なので、本文コンテナを共通の印にする */
const legalMarker = async (page: Page) => {
	await expect(page.getByTestId("legal-screen-document")).toBeVisible();
};

/**
 * ルートに対応する「描画されたと言える印」を返す。
 *
 * @param route locale prefix より後ろのパス
 */
const markerFor = (route: string) => {
	if (ROUTE_MARKERS[route]) return ROUTE_MARKERS[route];
	if (route.startsWith("legal/")) return legalMarker;
	// 既定: タブバーが出ていれば「共通レイアウトから下が描画されている」と言える
	return async (page: Page) => {
		await expect(page.getByTestId("tab-search")).toBeVisible();
	};
};

/**
 * prerender された HTML に必ず入っているべき testID を返す。
 *
 * タブ画面はタブバー、法務ページは本文コンテナ。どちらも `Stack` より下＝
 * REL-01 で 1 度も描画されなかった領域にある。
 *
 * @param route locale prefix より後ろのパス
 */
const prerenderMarkerFor = (route: string): string =>
	route.startsWith("legal/") ? "legal-screen-document" : "tab-search";

test.describe("ディープリンク @smoke", () => {
	for (const route of DEEP_LINK_SMOKE_ROUTES) {
		const url = `/${LOCALE}/${route}`;

		// ─ テストケース: 直リンクで画面が描画される ─
		// 手順:
		//   1. page.goto(url)（SPA 内遷移ではなく初回ロードで）
		//   2. ルート固有（既定はタブバー）の印が見えることを検証
		//   3. NotFound へ落ちていないことを検証
		//   4. console error / pageerror が 0 件であること（fixtures/test.ts の既定失敗条件）
		test(`${url} への直リンクで画面が描画される`, async ({ page }) => {
			await page.goto(url);
			await markerFor(route)(page);
			await expect(page.getByText("この画面は存在しません。")).toHaveCount(0);
		});

		// ─ テストケース: prerender された HTML に中身が入っている ─
		// 手順:
		//   1. JS を実行せずに HTML だけ取得する
		//   2. <body> のテキストが「Loading...」だけになっていないことを検証
		// #1503 【バグ】AppProvider の LoadScript が全ルートを包んでいたため、prerender では
		// children が 1 度も描画されず、公開 4 ルートの <body> がバイト単位で同一
		//（`<div></div><div>Loading...</div>` だけ）になっていた。ブラウザで開くと JS が
		// 動いて画面は出るので、**描画のテストだけでは検知できない**。ここは HTML を直接見る。
		test(`${url} の prerender された HTML に画面の中身が入っている`, async ({ request }) => {
			const response = await request.get(url);
			expect(response.status()).toBe(200);

			const html = await response.text();
			const body = html.match(/<body[\s\S]*<\/body>/)?.[0] ?? "";

			// LoadScript の既定 loadingElement。これが残っている = 中身が焼かれていない
			expect(body).not.toContain(">Loading...<");
			// 空シェルは実測 1,095 バイト（本番 2026-08-23）、中身のあるページは 10,000 バイト以上。
			// その間にしきい値を置く
			expect(body.length).toBeGreaterThan(3_000);
			// 共通レイアウト（タブバー / 法務ページ本文）が焼かれていること。
			// ⚠️ ルート固有の中身（例: profile-login-button）は **認証状態が決まってから**描画される
			//    ものがあり prerender には出ない。ここで見るのは「Stack より下が描画されたか」で、
			//    ルート固有の描画はブラウザ側のテスト（上）が見る
			expect(body).toContain(`data-testid="${prerenderMarkerFor(route)}"`);
		});
	}
});

/**
 * 存在しないパスの NotFound 画面。
 *
 * ## なぜ hydration 失敗（React error #418）を許容するのか
 *
 * Firebase Hosting は最後の rewrite `** → /index.html` で **prerender されていない URL を
 * すべて index.html（ルート `app/index.tsx` の静的出力）で返す**（firebase.json）。
 * 実測: `/ja-JP/this-route-does-not-exist` と `/` は **バイト単位で同一の HTML** が返る
 *（run 32716114752 の preview で md5 一致を確認）。
 *
 * その HTML はロケール解決前のルートの器で、本文テキストを持たない。ブラウザ側は URL に従って
 * `[locale]/+not-found.tsx` を描くので、サーバ HTML とクライアントの木が食い違い、
 * React は #418 を出してクライアント側で描き直す。**画面は正しく出る**（下の 2 つの
 * アサーションが実際に通っている）が、エラーは構造上必ず出る。
 *
 * これは «SPA フォールバックで配信される URL» すべてに共通する性質で、この画面固有の不具合ではない
 *（店舗詳細のような prerender されない動的ルートも同じ経路をたどる）。根本から消すには
 * 動的ルートごとに rewrite を張って catch-all を NotFound の静的出力へ向ける必要があり、
 * 張り忘れたルートが «正しい URL なのに NotFound» になる副作用を持つ。この spec の範囲を超えるため、
 * ここでは «出て当然のエラー» として明示的に許容する。
 *
 * ⚠️ `KNOWN_CONSOLE_NOISE` へ入れないこと。#418 は #1503 が prerender の不一致を捕まえるために
 * 使っている検知点で、全 spec で無視すると «公開ルートの hydration 不一致» が見えなくなる。
 */
test.describe("存在しないパス @smoke", () => {
	// 部分一致（本番ビルドは minify 済みの #418、dev ビルドは "Hydration failed" の文言で出る）
	test.use({ allowedConsoleErrors: ["Minified React error #418", "Hydration failed"] });

	// ─ テストケース: 存在しないパスで NotFound 画面が表示される ─
	// 手順:
	//   1. page.goto("/ja-JP/this-route-does-not-exist")
	//   2. NotFound 画面(ja-JP: 「この画面は存在しません。」)が表示されることを検証
	//   3. 「ホーム画面へ戻る」リンクが表示されることを検証
	test("存在しないパスで NotFound 画面が表示される", async ({ page }) => {
		await page.goto(`/${LOCALE}/this-route-does-not-exist`);
		await expect(page.getByText("この画面は存在しません。")).toBeVisible();
		await expect(page.getByText("ホーム画面へ戻る")).toBeVisible();
	});
});
