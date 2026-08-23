import { by, describeMutation, element, existsNow, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { RestaurantFeedScreen } from "../../screens/RestaurantFeedScreen";
import { ensureExternalEmbedImported } from "../../utils/externalEmbedImport";
import { localeDeepLink } from "../../utils/locale";
import { readSessionFromEnv } from "../../utils/sessionEnv";

/**
 * 🎞️ SNS 取り込みリールのフィード内再生 @mutation（#1375 / react-native-webview ブランチ）
 *
 * ## 目的（= オーナーへ見せる動画エビデンス）
 * 「取り込んだリールが保存後に再生されない」の対策として実装した
 * ExternalEmbedPlayer（WebView によるフィード内埋め込み + 再生ボタン）が、
 * **ネイティブモジュール入りの実ビルド**で動くことを録画で示す。
 * e2e-mobile はブランチのソースからネイティブごとビルドするため、
 * EAS Build の枠を消費せずに react-native-webview 入りの実機挙動を確認できる。
 *
 * ## dev DB への書き込み（@mutation の理由）
 * beforeAll がテストユーザーとして SNS 取り込み（resolve → create）を実行する。
 * create はサービス側が冪等（既存行は再利用し reactions(save) だけ保証する）なので、
 * 実行のたびに増えるのは「テストユーザーの食べたい」1 件分だけで、2 回目以降は実質読み等価。
 *
 * ## 検証の流れ
 * 1. Node 側で取り込みを保証し、保存先の restaurantId を得る
 * 2. お店フィード（/restaurant/{id}/feed）へ deep link で着地する
 *    （my-dishes リストは他の記録と混ざり順序が不定のため、店で絞って確実に出す）
 * 3. 埋め込み WebView（external-embed-webview）と再生ボタンが出ることを検証
 * 4. 再生ボタンをタップ → 操作モードへ入り、オーバーレイが消えることを検証
 *    （Instagram は中央への合成クリック注入で再生開始を試みる。録画にはその結果が映る）
 */
describeMutation("SNS 取り込みリールのフィード内再生 @mutation", () => {
	const restaurantFeed = new RestaurantFeedScreen();
	let restaurantId: string;

	beforeAll(async () => {
		const session = readSessionFromEnv("authenticated");
		if (!session) {
			throw new Error("認証済みセッションが無いため external-embed の取り込みを準備できません。");
		}
		({ restaurantId } = await ensureExternalEmbedImported(session.accessToken));
	});

	it("取り込んだリールがフィードに埋め込み表示され、再生ボタンで操作モードへ入る", async () => {
		// ⚠️ waitForReady（= タブバーの表示待ち）は使えない。/restaurant/.../feed は
		// (tabs) の外の全画面ルートでタブバーが出ないため、既定のままだと 120s 待って落ちる
		// （run 32652789508 で実測。アプリ自体はフィードに正常着地していた）
		await launchAppWithSession({
			as: "authenticated",
			url: localeDeepLink(`restaurant/${restaurantId}/feed`),
			waitForReady: false,
		});
		await waitUntilVisible(restaurantFeed.container, 120_000);

		// 埋め込みセルまでスワイプで探す（このお店の記録は少ないので通常は先頭にいる）
		const embedWebView = by.id("external-embed-webview");
		for (let i = 0; i < 10 && !(await existsNow(embedWebView)); i++) {
			await element(restaurantFeed.container).swipe("up", "fast", 0.6);
		}
		await waitUntilVisible(embedWebView);

		// 再生ボタン → 操作モード（オーバーレイが消え、WebView がタッチを受ける状態になる）
		const playButton = by.id("external-embed-open-browser");
		await waitUntilVisible(playButton);
		// 録画に「埋め込みカードが表示されている」状態をしばらく残す
		await new Promise((resolve) => setTimeout(resolve, 4_000));
		await element(playButton).tap();

		await waitUntilVisible(embedWebView);
		const overlayGone = !(await existsNow(by.id("external-embed-fallback")));
		if (!overlayGone) {
			throw new Error("再生ボタンをタップしたのに操作モードへ入っていません（オーバーレイが残っています）");
		}
		// 操作モードを抜ける口が出ていること（独立レビュー指摘: 抜けられないと戻れなくなる）
		await waitUntilVisible(by.id("external-embed-exit-interactive"));

		// 操作モードの埋め込みを 1 回タップする（録画用の最後の操作）。
		// 中央は provider 側のリンク（Android は target=_blank）で、アプリ側のガード
		// （setSupportMultipleWindows=false + isInlineEmbedUrl → アプリ内ブラウザ）が働く。
		// ※ run 32654704176 ではガードが無く、フルサイトがセル内／画面外の WebView へ
		//    読み込まれてアプリのプロセスごと落ちた。この spec はその回帰テストを兼ねる
		await element(embedWebView).tap();
		await new Promise((resolve) => setTimeout(resolve, 8_000));

		// ⚠️ ここで «アプリが生きていること» を必ず 1 つ検証する。
		// タップ後に assertion が無いと、プロセスが死んでも緑で終わる（独立レビュー指摘 9-b）
		await element(by.id("external-embed-exit-interactive")).tap();
		await waitUntilVisible(by.id("external-embed-fallback"));
		await waitUntilVisible(restaurantFeed.container);
	});
});
