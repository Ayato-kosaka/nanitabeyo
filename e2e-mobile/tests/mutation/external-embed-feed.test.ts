import { by, describeMutation, element, existsNow, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { RestaurantFeedScreen } from "../../screens/RestaurantFeedScreen";
import { ensureExternalEmbedImported } from "../../utils/externalEmbedImport";
import { localeDeepLink } from "../../utils/locale";
import { readSessionFromEnv } from "../../utils/sessionEnv";

/**
 * 🎞️ SNS 取り込みリールの **アプリ内自動再生** @mutation（#1641 / react-native-webview ブランチ）
 *
 * ## 目的（= オーナーへ見せる動画エビデンス）
 *
 * オーナーの要求は「アプリ内で再生できて、出来るだけインスタでリールを見てるのと同じ感覚」。
 * 判定条件は **セルが前面に来た時点で、タップせずに映像が動き出すこと**（#1641 の受け入れ条件 3）。
 *
 * ## この spec が以前は «再生を検証できていなかった» こと
 *
 * 旧版は `DZFdePPzzLI` 1 本だけを取り込んでいた。これは **権利ブロックされた投稿**で、
 * 埋め込みページに `<video>` が 1 つも作られない（#1375 のコメント 5418882999 で実測）。
 * つまり **どんな実装でも再生できない素材**で回しており、緑でも
 * 「アプリ内で再生できた」の根拠にならなかった。
 *
 * 現在は同じお店フィードへ 2 本を取り込む。
 *
 * | リール | 埋め込みの中身 | このセルで期待すること |
 * | --- | --- | --- |
 * | `CDg3owdFa6W`（Original audio） | 実体の `<video>` + 実 MP4 | **タップ無しで再生が始まる** = `external-embed-fallback` が出ない |
 * | `DZFdePPzzLI`（ライセンス楽曲） | `<video>` 無し | 再生されず «Instagram で見る» の帯（`external-embed-fallback`）が出る |
 *
 * ⚠️ **Detox の assertion だけでは «映像が動いている» ことは示せない。**
 * ここで検証しているのは «アプリが再生できると判断したか»（フォールバックの有無）まで。
 * 実際に絵が動いていることは **`record_videos: true` で撮った動画をオーナーが見て**判定する。
 * spec を緑にすることを目的にして、動画を撮らずに «再生できた» と報告しないこと。
 *
 * ## dev DB への書き込み（@mutation の理由）
 * beforeAll がテストユーザーとして SNS 取り込み（resolve → create ×2）を実行する。
 * create はサービス側が冪等（既存行は再利用し reactions(save) だけ保証する）なので、
 * 実行のたびに増えるのは「テストユーザーの食べたい」2 件分だけで、2 回目以降は実質読み等価。
 */
describeMutation("SNS 取り込みリールのアプリ内自動再生 @mutation", () => {
	const restaurantFeed = new RestaurantFeedScreen();
	let restaurantId: string;

	beforeAll(async () => {
		const session = readSessionFromEnv("authenticated");
		if (!session) {
			throw new Error("認証済みセッションが無いため external-embed の取り込みを準備できません。");
		}
		({ restaurantId } = await ensureExternalEmbedImported(session.accessToken, { alsoImportPlayable: true }));
	});

	it("取り込んだリールがフィードで自動再生され、再生できない投稿だけが導線へ縮退する", async () => {
		// ⚠️ waitForReady（= タブバーの表示待ち）は使えない。/restaurant/.../feed は
		// (tabs) の外の全画面ルートでタブバーが出ないため、既定のままだと 120s 待って落ちる
		// （run 32652789508 で実測。アプリ自体はフィードに正常着地していた）
		await launchAppWithSession({
			as: "authenticated",
			url: localeDeepLink(`restaurant/${restaurantId}/feed`),
			waitForReady: false,
		});
		await waitUntilVisible(restaurantFeed.container, 120_000);

		// 埋め込みセルまでスワイプで探す（このお店の記録は少ないので通常は先頭付近にいる）
		const embedWebView = by.id("external-embed-webview");
		for (let i = 0; i < 10 && !(await existsNow(embedWebView)); i++) {
			await element(restaurantFeed.container).swipe("up", "fast", 0.6);
		}
		await waitUntilVisible(embedWebView);

		/*
		#1641 **タップを一切しない。** 自動再生が要件なので、ここで何かを押した時点で
		「タップ無しで動く」を検証したことにならない。埋め込みの読み込みと `play()` の
		注入が終わるまで待ち、録画に «勝手に動き出す» ところを残す。
		*/
		await new Promise((resolve) => setTimeout(resolve, 12_000));

		/*
		2 本のうち少なくとも 1 本は «再生できる» と判定されていること。
		`external-embed-fallback`（Instagram で見る の帯）は **再生できない投稿にだけ**出る。
		両方のセルで出ているなら、自動再生の経路が丸ごと効いていない。
		*/
		const cells: { fallback: boolean }[] = [];
		for (let i = 0; i < 6; i++) {
			if (await existsNow(embedWebView)) {
				cells.push({ fallback: await existsNow(by.id("external-embed-fallback")) });
			}
			await element(restaurantFeed.container).swipe("up", "fast", 0.6);
			// 次のセルの埋め込みが読み込まれ、自動再生の判定が終わるまで待つ
			await new Promise((resolve) => setTimeout(resolve, 8_000));
		}

		if (cells.length === 0) {
			throw new Error("埋め込みセルを 1 つも観測できませんでした（取り込みかフィードの経路が壊れています）。");
		}
		const playable = cells.filter((c) => !c.fallback).length;
		if (playable === 0) {
			throw new Error(
				`観測した埋め込みセル ${cells.length} 件が全て «再生できない» 判定でした。` +
					" 自動再生の注入（injectedJavaScript）が効いていない可能性があります。" +
					" 動画（Artifact の test.mp4）で実際の見え方を確認してください。",
			);
		}

		// ⚠️ ここで «アプリが生きていること» を必ず 1 つ検証する。
		// スワイプ後に assertion が無いと、プロセスが死んでも緑で終わる（独立レビュー指摘 9-b）
		await waitUntilVisible(restaurantFeed.container);
	});
});
