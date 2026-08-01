import { by, launchAppWithSession, localeDeepLink, waitUntilVisible } from "../../fixtures/e2e";

/**
 * 🔗 ディープリンクスモークテスト @smoke
 *
 * 目的: ロケールセグメント付きディープリンク(`nanitabeyo:///ja-JP/...`)からの直接起動で、
 *       expo-router のルーティングが素通しで機能していることを保証する
 *       (e2e-web の tests/smoke/deep-link.spec.ts に対応)。
 * 検証範囲: 代表的な直リンク 2 画面(検索 / マイページ)。
 *
 * ## URL の組み立て方(#1031 確定 B4)
 * expo-router は `/[locale]/...` 構成のため、システムロケールに任せず
 * `localeDeepLink()` で ja-JP セグメントを明示したディープリンクを組み立てて起動する。
 *
 * ## e2e-web との差分(NotFound 画面を対象外とした理由)
 * e2e-web は「存在しないパスで NotFound 画面が表示される」も検証しているが、
 * ネイティブの NotFound 画面(app-expo/app/[locale]/+not-found.tsx)には
 * testID が実装されていない(grep 済み)。本規約(セレクタは testID 最優先、
 * 存在しない testID は使わない)に従い、本 spec ではこのシナリオを対象外とする。
 * testID 追加(#1031 レビュー m8 で指摘済み)は別 PR のスコープとする。
 */
describe("ディープリンク @smoke", () => {
	// ─ テストケース: 検索画面への直リンクが表示される ─
	// 手順:
	//   1. localeDeepLink("search") で "nanitabeyo:///ja-JP/search" を組み立てる
	//   2. launchAppWithSession({ as: "anon", url }) でそのディープリンクから直接起動する
	//   3. 検索ヘッダが表示されることを検証
	//      testID: search-header-title (ja-JP: Search.headerTitle)
	it("検索画面への直リンクが表示される", async () => {
		await launchAppWithSession({ as: "anon", url: localeDeepLink("search") });
		await waitUntilVisible(by.id("search-header-title"));
	});

	// ─ テストケース: マイページへの直リンクが表示される ─
	// 手順:
	//   1. localeDeepLink("profile") で "nanitabeyo:///ja-JP/profile" を組み立てる
	//   2. launchAppWithSession({ as: "anon", url }) でそのディープリンクから直接起動する
	//   3. ゲスト向けログインボタンが表示されることを検証
	//      testID: profile-login-button (ja-JP: auth.btn_login)
	it("マイページへの直リンクが表示される", async () => {
		await launchAppWithSession({ as: "anon", url: localeDeepLink("profile") });
		await waitUntilVisible(by.id("profile-login-button"));
	});
});
