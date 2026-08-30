import { by, launchAppWithSession, localeDeepLink, waitUntilVisible } from "../../fixtures/e2e";
import { DEEP_LINK_SMOKE_ROUTES } from "@app-expo/lib/seo/publicRoutes";

/**
 * 🔗 ディープリンクスモークテスト @smoke
 *
 * 目的: ロケールセグメント付きディープリンク(`nanitabeyo:///ja-JP/...`)からの直接起動で、
 *       expo-router のルーティングが素通しで機能していることを保証する
 *       (e2e-web の tests/smoke/deep-link.spec.ts に対応)。
 * 検証範囲: 公開ルート全件（`app-expo/lib/seo/publicRoutes.ts` の `DEEP_LINK_SMOKE_ROUTES`）。
 *
 * ## #1503 なぜ手書きの 2 本から «配列を回す» 形へ変えたか
 * REL-01 では公開 4 ルートすべての直リンクが白画面だったのに、この spec は
 * 検索 / マイページの 2 本しか持っていなかった。**手で書いた一覧はルートが増えても増えない。**
 * 一覧は web と共有の 1 箇所（`publicRoutes.ts`）にあり、ルートを足す人はそこへ 1 行足すだけでよい。
 * 足し忘れは `app-expo/__tests__/publicRoutes.test.ts` が落とす。
 *
 * ## URL の組み立て方(#1031 確定 B4)
 * expo-router は `/[locale]/...` 構成のため、システムロケールに任せず
 * `localeDeepLink()` で ja-JP セグメントを明示したディープリンクを組み立てて起動する。
 *
 * ## web との差分
 * - **prerender の検査はネイティブに無い**（HTML が無いため）。REL-01 の «prerender が空» の
 *   回帰検知は web 側の spec が担当する
 * - NotFound 画面(app-expo/app/[locale]/+not-found.tsx)には testID が無いため対象外
 *   （本規約: 存在しない testID は使わない。#1031 レビュー m8 の指摘どおり testID 追加は別 PR）
 */

/**
 * ルートごとの「描画されたと言える印」（testID）。
 *
 * 未定義のルートはタブバー（`tab-search`）を既定の印にする。
 * web の spec と同じ testID を見ている（同じ React コンポーネントが両方を描画するため）。
 */
const ROUTE_MARKER_IDS: Record<string, string> = {
	search: "search-header-title",
	review: "review-guest-description",
	"review/selectRestaurant": "review-select-restaurant-current-location-button",
	profile: "profile-login-button",
	notifications: "notifications-header-title",
};

/**
 * ルートに対応する testID を返す。
 *
 * @param route locale prefix より後ろのパス（例: `legal/terms`）
 * @returns 「描画されたと言える印」の testID
 */
const markerIdFor = (route: string): string => {
	if (ROUTE_MARKER_IDS[route]) return ROUTE_MARKER_IDS[route];
	// 法務ページはタブの外。本文コンテナを印にする
	if (route.startsWith("legal/")) return "legal-screen-document";
	return "tab-search";
};

describe("ディープリンク @smoke", () => {
	for (const route of DEEP_LINK_SMOKE_ROUTES) {
		// ─ テストケース: 各公開ルートへの直リンクが表示される ─
		// 手順:
		//   1. localeDeepLink(route) で "nanitabeyo:///ja-JP/<route>" を組み立てる
		//   2. launchAppWithSession({ as: "anon", url }) でそのディープリンクから直接起動する
		//   3. ルート固有（既定はタブバー）の testID が表示されることを検証
		it(`${route} への直リンクが表示される`, async () => {
			await launchAppWithSession({ as: "anon", url: localeDeepLink(route) });
			await waitUntilVisible(by.id(markerIdFor(route)));
		});
	}
});
