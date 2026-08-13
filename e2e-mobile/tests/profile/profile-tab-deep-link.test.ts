import {
	by,
	describeAuthenticated,
	element,
	launchAppWithSession,
	localeDeepLink,
	waitUntilExists,
} from "../../fixtures/e2e";

/**
 * 🔗 #1272 «?tab= 付きの直リンクがタブ切り替えまで届く» の回帰テスト（Tier 2）
 *
 * ## 経緯（probe からの昇格。tests/probe/README.md の手順 4）
 * iOS では `?tab=saved-topics` 付きで起動しても先頭タブのまま着地していた。
 * 原因は 2 層あり、どちらも probe（旧 tests/probe/profile-tab-param.test.ts）の実測値で確定した:
 *
 * | probe 実測 | 原因 | 修正 |
 * | --- | --- | --- |
 * | `local=- global=- jump=none` | app/index.tsx の起動リダイレクトが `Linking.parse().path` でクエリを落とす | `extractQueryString` で運ぶ（lib/deepLinkTarget.ts） |
 * | `local=saved-topics jump=gaveup` | jumpToTab の effect が auth 解決に追従せず、ref が生える前にリトライが尽きる | deps へ `isAuthResolved` を追加 |
 *
 * Android は expo-router 側の初期 URL 解決が先に済むため症状が出ない（= 「片方の OS だけ
 * 壊れる」形だった）。この spec は両プラットフォームで走り、どちらの退行も検知する。
 *
 * ## 観測点はアプリ側のプローブ（routeParamsProbe）
 * 検証は «実際に着地したタブの見た目» ではなく、E2E ビルド限定の
 * `profile-route-params-probe`（app-expo/lib/e2e/routeParamsProbe.tsx）を読む。
 * 理由: 「クエリが届いたか」と「タブ切り替えが発火したか」は別の層の事実で、
 * 見た目だけを見ると退行時に **どの層が壊れたのか** がまた分からなくなる（3 仮説を
 * 外し続けた反省）。失敗メッセージには必ず実測値を載せる。
 *
 * ## ログイン済み前提である理由
 * `saved-topics` タブは isOwnProfile のときだけ tabRoutes に入る。また #1272 の 2 層目
 * （auth 解決とのレース）は **セッション注入起動でしか再現しない**ため、匿名では検証にならない。
 */
describeAuthenticated("マイページの ?tab= 直リンク（#1272）", () => {
	const probe = by.id("profile-route-params-probe");

	// ─ テストケース: ?tab=saved-topics 付き直リンクでパラメータがタブ切り替えまで届く ─
	// 手順:
	//   1. /profile?tab=saved-topics へ直リンクで起動する
	//   2. プローブ（profile-route-params-probe）の出現を待つ
	//   3. 実測値を読み、(a) クエリがレイアウトへ届いていること (b) jumpToTab が発火したことを検証
	it("?tab=saved-topics 付き直リンクでパラメータがタブ切り替えまで届く", async () => {
		await launchAppWithSession({
			as: "authenticated",
			url: `${localeDeepLink("profile")}?tab=saved-topics`,
		});

		await waitUntilExists(probe);

		// getAttributes で実測値を吸い出す（戻り値の型は iOS / Android で分かれるため text だけを拾う）
		const attributes = (await element(probe).getAttributes()) as { text?: string };
		const measured = attributes.text ?? "(text 属性なし)";

		const delivered = measured.includes("global=saved-topics") || measured.includes("local=saved-topics");
		const jumped = /jump=(direct|retried:\d+)/.test(measured);

		// 失敗メッセージに実測値を必ず載せる（どの層が壊れたかを一発で示すのがこの spec の存在意義）
		if (!delivered || !jumped) {
			throw new Error(
				[
					"#1272 が退行しています。実測値がどの層かを示します（routeParamsProbe の doc コメント参照）:",
					`  ${measured}`,
					`  delivered=${delivered}（false なら起動リダイレクトがクエリを落としている: lib/deepLinkTarget.ts）`,
					`  jumped=${jumped}（false なら jumpToTab が発火していない: ProfileTabsLayout の effect deps）`,
				].join("\n"),
			);
		}
	});
});
