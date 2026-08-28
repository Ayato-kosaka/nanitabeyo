import { by, describeMutation, device, element, existsNow, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
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
 * | 投稿 | 埋め込みの中身 | このセルで期待すること |
 * | --- | --- | --- |
 * | `CDg3owdFa6W`（Instagram / Original audio） | 実体の `<video>` + 実 MP4 | **タップ無しで再生が始まる** |
 * | `Dcfhw8wFFm4`（Instagram / オーナー報告の投稿） | 同上 | 同上 |
 * | `DZFdePPzzLI`（Instagram / ライセンス楽曲） | `<video>` 無し | 再生されず «Instagram で見る» の帯が出る |
 * | TikTok の投稿 | 実体の `<video>` | **タップ無しで再生が始まる**（#1641） |
 * | YouTube の動画 | iframe の中（別オリジン） | **タップ無しで再生が始まる**（#1641） |
 *
 * 合否は `external-embed-playing-{provider}` で **provider ごとに**見る。
 * まとめて 1 つの印にすると「Instagram だけ再生できていて YouTube は死んでいる」を見逃す。
 *
 * ## ⚠️ «帯が出ないこと» を «再生できたこと» と読み替えてはいけない
 *
 * `external-embed-fallback`（Instagram で見る の帯）は読み込み中も出ない。したがって
 * «帯が無い» を合格条件にすると、**何も再生していなくても緑になる**（＝ 偽の «直った»）。
 * 判定には `external-embed-playing` を使う。これはページ内のエージェントが
 * **`<video>` の再生が実際に始まった**（`playing` イベント / `currentTime > 0`）と
 * 報告したときにだけ現れる、寸法ゼロの印である。
 *
 * ⚠️ それでも **Detox の assertion は «絵が動いていること» までは示せない**（ポスター画像が
 * 上に残る等の失敗形がある）。だから **連続したコマを端末のスクリーンショットで撮る**。
 *
 * ## なぜ動画ではなくスクリーンショットの連写なのか
 *
 * `record_videos: true` の `test.mp4` は、**ヘッドレスの Android エミュレータでは
 * ホーム画面のまま固まる**ことがある（run 33061555648 で実測。91 秒すべてホーム画面で、
 * 端末の時計まで止まっていた。同じ run の `testDone.png` にはアプリが正しく写っている）。
 * 動画を «動きの証拠» として当てにできないので、`device.takeScreenshot` で
 * 1.5 秒おきに撮る。**コマ同士で絵が違えば、それが動いた証拠になる。**
 *
 * ## dev DB への書き込み（@mutation の理由）
 * beforeAll がテストユーザーとして SNS 取り込み（resolve → create ×2）を実行する。
 * create はサービス側が冪等（既存行は再利用し reactions(save) だけ保証する）なので、
 * 実行のたびに増えるのは「テストユーザーの食べたい」2 件分だけで、2 回目以降は実質読み等価。
 */
describeMutation("SNS 取り込みリールのアプリ内自動再生 @mutation", () => {
	const restaurantFeed = new RestaurantFeedScreen();
	let restaurantId: string;

	/**
	 * フィードを 1 ページ送る。
	 *
	 * ⚠️ **埋め込みが前面にいる間は、フィードのコンテナを掴んでスワイプできない。**
	 * iOS の Detox は «操作する要素が 100% 見えていること» を要求するが、埋め込みセルでは
	 * WebView がコンテナを覆うため条件を満たさず、
	 * `View does not pass visibility percent threshold (100)` で落ちる
	 * （run 33064372163 の iOS で実測。Android は同じ手順で通る）。
	 *
	 * そこで **WebView の上からスワイプする**。WebView は `pointerEvents="none"` なので
	 * 指の動きはそのまま下の FlatList へ抜ける。
	 * これは回避策であると同時に、**受け入れ条件 5「埋め込みの上から縦スワイプで次のセルへ行ける」
	 * そのものの検証**になっている。
	 */
	const swipeFeed = async () => {
		const embedWebView = by.id("external-embed-webview");
		const target = (await existsNow(embedWebView)) ? embedWebView : restaurantFeed.container;
		await element(target).swipe("up", "fast", 0.6, 0.5, 0.5);
	};

	/*
	⚠️ **この spec の間だけ Detox の同期機構を切る。**

	Detox（iOS）は «アプリが暇になる» のを待ってから assertion を実行する。ところが
	埋め込みのリールは着地した瞬間から**鳴り止まずに再生し続ける**ので、アプリは
	最後まで暇にならない。実測（run 33065565293 / iOS）では

	    The app is busy with the following tasks:
	    • There are 2 work items pending on the dispatch queue: "Main Queue".
	    • Run loop "Main Run Loop" is awake.

	が 2 分間出続け、`restaurant-feed-screen` を待つだけの最初の 1 行が
	`Timed out while waiting for expectation` で落ちた。**同じ run の
	`testFnFailure.png` にはフィードもリールも正しく写っている**ので、
	アプリではなく待ち方の問題である。

	自動再生を検証する spec で «再生が止まるのを待つ» ことはできない。この spec は
	画面を眺めてコマを撮るだけで、操作のタイミングに依存しないので、
	同期を切って明示的に待つのが正しい（`review-submit-loading.test.ts` と同じ扱い）。
	*/
	beforeAll(async () => {
		const session = readSessionFromEnv("authenticated");
		if (!session) {
			throw new Error("認証済みセッションが無いため external-embed の取り込みを準備できません。");
		}
		({ restaurantId } = await ensureExternalEmbedImported(session.accessToken, {
			alsoImportPlayable: true,
			alsoImportOtherProviders: true,
		}));
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
		await device.disableSynchronization();
		/*
		⚠️ **可視ではなく «在るか» で待つ。**

		埋め込みセルが前面に来ると、全画面の WebView が `restaurant-feed-screen` を
		**100% 覆う**。iOS の `toBeVisible()` は «その View 自身の画素が見えていること» を
		要求するので、覆われている間は永久に真にならない（run 33070499541 で実測。
		同じ run の `testFnFailure.png` にはフィードもリールも正しく写っている）。

		«画面が出たこと» は、この直後の `waitUntilVisible(embedWebView)`（前面にいるので
		可視判定が効く）で担保する。
		*/
		if (!(await existsNow(restaurantFeed.container, 120_000))) {
			throw new Error("お店フィードの画面に着地できませんでした。");
		}

		// 埋め込みセルまでスワイプで探す（このお店の記録は少ないので通常は先頭付近にいる）
		const embedWebView = by.id("external-embed-webview");
		for (let i = 0; i < 10 && !(await existsNow(embedWebView)); i++) {
			await swipeFeed();
		}
		await waitUntilVisible(embedWebView);

		/*
		#1641 **タップを一切しない。** 自動再生が要件なので、ここで何かを押した時点で
		「タップ無しで動く」を検証したことにならない。

		埋め込みの読み込みと `play()` の注入を待ちながら、**1.5 秒おきにコマを撮る**。
		オーナーはこの連番を並べて «絵が変わっているか» を見る（＝ 動いたかどうかの判定）。
		*/
		/*
		⚠️ **iOS のコマは «動いた証拠» として使えない**（run 33074457233 で実測）。
		9 枚すべてが**バイト単位で同一**になり、しかも «着地した瞬間» の 00 まで
		読み込み済みのリールが写っていた（Android では 00 は黒い）。つまり撮り直されておらず、
		最後の 1 枚が 9 回書かれている。`device.disableSynchronization()` を入れてから出た挙動。

		同じ run の Android は 9 枚とも別のコマになる（md5 が全て異なる）ので、
		**この撮り方自体は正しい**。iOS の動きは `record_videos: true` の `test.mp4` で確認すること。
		*/
		await device.takeScreenshot("autoplay-00-arrived");
		for (let i = 1; i <= 8; i++) {
			await new Promise((resolve) => setTimeout(resolve, 1_500));
			await device.takeScreenshot(`autoplay-${String(i).padStart(2, "0")}-t${(i * 1.5).toFixed(1)}s`);
		}

		/*
		2 本のうち少なくとも 1 本で **実際に再生が始まっている**こと。
		判定は `external-embed-playing`（再生開始の報告を受けたときだけ出る印）で行う。
		`external-embed-fallback` の有無は記録するだけで合否には使わない（読み込み中と区別できないため）。
		*/
		const PROVIDERS = ["instagram", "tiktok", "youtube"] as const;
		/** provider ごとに «アプリ内で再生が始まった» を観測できたか */
		const playedBy: Record<(typeof PROVIDERS)[number], boolean> = {
			instagram: false,
			tiktok: false,
			youtube: false,
		};
		let embedCells = 0;

		for (let i = 0; i < 10; i++) {
			if (await existsNow(embedWebView)) {
				embedCells += 1;
				for (const provider of PROVIDERS) {
					if (await existsNow(by.id(`external-embed-playing-${provider}`))) {
						playedBy[provider] = true;
					}
				}
			}
			await swipeFeed();
			// 次のセルの埋め込みが読み込まれ、自動再生の判定が終わるまで待つ
			await new Promise((resolve) => setTimeout(resolve, 8_000));
			await device.takeScreenshot(`feed-${String(i).padStart(2, "0")}`);
		}

		if (embedCells === 0) {
			throw new Error("埋め込みセルを 1 つも観測できませんでした（取り込みかフィードの経路が壊れています）。");
		}

		/*
		#1641 **3 つの provider すべてがアプリ内で再生できること。**

		オーナー報告:「YouTube shorts がアプリ内再生出来ない」「TikTok をアプリ内再生必須」。

		| provider | 再生のさせ方 |
		| --- | --- |
		| instagram | 埋め込みを直接開き、`<video>` を注入して `play()` |
		| tiktok | 同上（«1 タップ要る» という以前の記述は誤りだった） |
		| youtube | 直接開くとエラー 153 になるので、包みの HTML の中に iframe として置く |

		⚠️ 素材は «再生できることが分かっているもの» を使っている（`externalEmbedImport.ts`）。
		   再生できない投稿を素材にすると、実装が正しくても永久に赤になる。
		*/
		const notPlayed = PROVIDERS.filter((provider) => !playedBy[provider]);
		if (notPlayed.length > 0) {
			throw new Error(
				`アプリ内で再生が始まらなかった provider: ${notPlayed.join(", ")}` +
					`（観測した埋め込みセル ${embedCells} 件 / 再生できた: ${
						PROVIDERS.filter((p) => playedBy[p]).join(", ") || "なし"
					}）。` +
					" 判定は external-embed-playing-{provider}（ページ内から «再生が始まった» と報告があったときだけ出る印）で行っている。",
			);
		}

		/*
		⚠️ ここで «アプリが生きていること» を必ず 1 つ検証する。
		スワイプ後に assertion が無いと、プロセスが死んでも緑で終わる（独立レビュー指摘 9-b）。

		⚠️ ただし `toBeVisible()` では検証できない（上の «可視ではなく在るかで待つ» と同じ理由。
		全画面の埋め込みがフィードを覆っている）。`existsNow` はビューツリーを問い合わせるので、
		**プロセスが死んでいれば `rethrowIfAppIsGone` が例外を投げる** = 目的は達せられる。
		*/
		if (!(await existsNow(restaurantFeed.container))) {
			throw new Error("スワイプ後にお店フィードの画面が消えました（アプリが落ちた疑い）。");
		}
	});

	// 同じ run の後続 spec を «同期の切れた» 状態へ持ち越さない
	afterAll(async () => {
		await device.enableSynchronization();
	});
});
