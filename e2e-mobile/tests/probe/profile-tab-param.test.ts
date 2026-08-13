import { by, describeProbe, element, launchAppWithSession, localeDeepLink, waitUntilExists } from "../../fixtures/e2e";

/**
 * 🧪 #1272 «iOS では ?tab= 付きの直リンクが先頭タブのまま着地する» の原因を数値で確定する @probe
 *
 * ## 何を測るか
 * `app-expo/lib/e2e/routeParamsProbe.tsx`（E2E ビルド限定）が ProfileTabsLayout の実測値を
 * `profile-route-params-probe` に描画する:
 *
 *   `local=<useLocalSearchParams の tab> global=<useGlobalSearchParams の tab>
 *    requested=<検証後の requestedTab> auth=<isAuthResolved> jump=<jumpToTab の結末>`
 *
 * ## 読み方（このプローブが切り分ける 3 つの仮説）
 * - `local=- global=-` … expo-router がクエリを**そもそも届けていない**。
 *   起動 URL の処理経路（app/index.tsx / linking 設定）の問題で、ProfileTabsLayout を
 *   いくら直しても直らない。修正先はルーティング層
 * - `global=saved-topics` なのに先頭タブ … パラメータは届いており、
 *   **jumpToTab / initialTabName が効いていない**。`jump=` の値でさらに割れる:
 *   - `jump=direct` / `retried:<n>` … 呼べているのに動かない → react-native-collapsible-tab-view 側
 *   - `jump=gaveup` … ref が 2 秒以内に生えない → auth 解決がリトライ上限より遅い（上限の設計問題）
 *   - `jump=none` … effect 自体が発火していない → requestedTab が undefined（検証で弾かれている）
 *
 * ## これまでに外した仮説（同じ修正を繰り返さないための記録）
 * jumpToTab の ref リトライ（#954 修正）/ tabRoutes の検証漏れ / useGlobalSearchParams の併用、
 * の 3 つを**すべてコード修正で試して外した**。観測せずに直し続けたのが誤りで、この probe が反省の形。
 *
 * ## 実行方法
 * 既定の tier1-2 には含まれない（落ちるのが正しい spec のため。tests/probe/README.md）。
 *   e2e-mobile-test.yml を scope=probe で dispatch（platform=ios。Android は #1272 の症状が出ない）
 */
describeProbe("#1272 ?tab= 直リンクのパラメータ到達 @probe", () => {
	const probe = by.id("profile-route-params-probe");

	// ─ プローブ: ?tab=saved-topics 付きで起動し、各段の実測値を失敗メッセージへ載せる ─
	it("?tab=saved-topics 付き直リンクでパラメータがタブ切り替えまで届く", async () => {
		await launchAppWithSession({
			as: "authenticated",
			url: `${localeDeepLink("profile")}?tab=saved-topics`,
		});

		await waitUntilExists(probe);

		// getAttributes で実測値を吸い出す（戻り値の型は iOS / Android で分かれるため text だけを拾う）
		const attributes = (await element(probe).getAttributes()) as { text?: string };
		const measured = attributes.text ?? "(text 属性なし)";

		// 期待値: パラメータが届き、jumpToTab まで成立していること。
		// 失敗メッセージに実測値を必ず載せる（数値が出ないなら probe の意味がない。README 参照）
		const delivered = measured.includes("global=saved-topics") || measured.includes("local=saved-topics");
		const jumped = /jump=(direct|retried:\d+)/.test(measured);

		if (!delivered || !jumped) {
			throw new Error(
				[
					"#1272 の実測値（この値が原因の切り分けそのもの。probe の doc コメントの読み方に従うこと）:",
					`  ${measured}`,
					`  delivered=${delivered} jumped=${jumped}`,
				].join("\n"),
			);
		}
	});
});
