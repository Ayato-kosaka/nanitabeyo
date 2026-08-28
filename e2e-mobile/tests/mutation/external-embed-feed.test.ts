import {
	by,
	describeMutation,
	device,
	element,
	existsNow,
	launchAppWithSession,
	tapWhenPresent,
	waitUntilVisible,
} from "../../fixtures/e2e";
import { RestaurantFeedScreen } from "../../screens/RestaurantFeedScreen";
import { ensureExternalEmbedImported } from "../../utils/externalEmbedImport";
import { logMemory } from "../../utils/memoryProbe";
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
			// #1641 オーナー要望: 権利で再生できない側のレイアウトも実機のコマで残す
			alsoImportUnplayable: true,
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
		/*
		#1641 **«そのセルへ着けたか» も別に記録する。**

		run 33138096398 の失敗文は «instagram, tiktok が再生できなかった» としか言わず、
		セルへ着けていないのか着いたが再生しないのかが分からなかった。実際は
		**そのセルがフィードに存在していなかった**（取り込みを同じ料理へ入れており、
		お店フィードは料理 1 件につき 1 本しか返さない）。両方を持てば失敗文で切り分く。
		*/
		const reachedBy: Record<(typeof PROVIDERS)[number], boolean> = {
			instagram: false,
			tiktok: false,
			youtube: false,
		};
		let embedCells = 0;

		/*
		⚠️ **1 回見て «再生できなかった» と判定してはいけない。**

		旧版は「スワイプ → 7 秒待つ → 次の周回の先頭で 1 回だけ見る」だった。
		これだと読み込みが 7 秒に間に合わないセルを «再生できない» と誤判定する。

		    最初のセル（着地後 12 秒眺める）… YouTube → 緑
		    以降のセル（7 秒しか無い）      … Instagram / TikTok → «再生できない»

		同じ素材は run 33074457233 / 33078365067 で再生できている。**埋め込みの読み込みが
		7 秒に間に合わなかっただけ**で、アプリの不具合ではない。読み込みの遅さで赤になる spec は、
		本物の回帰と区別が付かないので価値が無い。

		そこで **セルが前面にいる間、印が出るまで繰り返し見る**。印は一度出れば消えないので、
		「出るまで見る」で偽陰性だけが消え、偽陽性は増えない。
		*/
		const CELL_DWELL_MS = 18_000;
		/** 印の有無を見るときの上限。短くして 1 周を速く回す（既定の 2 秒だと 3 provider で 6 秒かかる） */
		const MARKER_PROBE_MS = 500;

		const allPlayed = () => PROVIDERS.every((provider) => playedBy[provider]);

		/** いま前面にいるセルを、印が出るまで（最長 dwellMs）見続ける。埋め込みセルだったら true */
		const observeCurrentCell = async (dwellMs: number): Promise<boolean> => {
			const deadline = Date.now() + dwellMs;
			let sawEmbed = false;
			for (;;) {
				let concluded = false;
				if (await existsNow(embedWebView, MARKER_PROBE_MS)) {
					sawEmbed = true;
					for (const provider of PROVIDERS) {
						if (!reachedBy[provider] && (await existsNow(by.id(`external-embed-cell-${provider}`), MARKER_PROBE_MS))) {
							reachedBy[provider] = true;
						}
						if (playedBy[provider]) continue;
						if (await existsNow(by.id(`external-embed-playing-${provider}`), MARKER_PROBE_MS)) {
							playedBy[provider] = true;
						}
					}
					/*
					#1641 **いま前面にいるセルが結論を出したか**を見る。«再生が始まった» か
					«導線へ縮退した» のどちらか。`playedBy` は run 全体で立ちっぱなしなので
					**このセルの判定には使えない**（いま見えている印を毎回読む）。

					結論が出る前に撮ると、権利分岐のエビデンスが
					**まだ何も描かれていない真っ黒なコマ**になる
					（run 33170443855 の feed-06 で実際に撮れた）。
					*/
					for (const provider of PROVIDERS) {
						if (await existsNow(by.id(`external-embed-playing-${provider}`), MARKER_PROBE_MS)) {
							concluded = true;
							break;
						}
					}
					if (!concluded) {
						concluded = await existsNow(by.id("external-embed-fallback"), MARKER_PROBE_MS);
					}
				}
				// 全部揃っていても、**このセルの結論が出るまでは眺める**（撮るコマを意味のあるものにする）
				if (concluded || Date.now() >= deadline) return sawEmbed;
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		};

		/*
		#1641 **セルを送るたびにメモリを 1 行残す。**

		埋め込みセルを 5 本並べたところ Android が `lowmemorykiller` でアプリを殺した
		（run 33133043261）。クラッシュではなくプロセス消滅なので、**何がどれだけ食ったのかを
		観測する手段が無かった**。直す前に «見えるようにする» のが先である。
		戻っているのか積み上がるだけなのかが run のログで分かる。
		*/
		logMemory("cell-start");

		for (let i = 0; i < 8; i++) {
			if (await observeCurrentCell(CELL_DWELL_MS)) embedCells += 1;
			logMemory(`cell-${String(i).padStart(2, "0")} reached=${PROVIDERS.filter((p) => reachedBy[p]).join("+") || "none"}`);
			await device.takeScreenshot(`feed-${String(i).padStart(2, "0")}`);
			/*
			#1641 **«音を出す» が出ていたら押してみる。**（オーナー指示 2026-08-28）

			自動では音を戻せなかったので、ユーザー操作なら通るのかを実機で測る。
			合否には使わない（押しても駄目なら «タップでも出せない» が確定するだけ）。
			結果は `external_embed_unmute_tapped` としてログへ落ちるので、BigQuery で読む。
			*/
			if (await existsNow(by.id("external-embed-unmute"), MARKER_PROBE_MS)) {
				await tapWhenPresent(by.id("external-embed-unmute"));
				await new Promise((resolve) => setTimeout(resolve, 4_000));
				await device.takeScreenshot(`unmute-${String(i).padStart(2, "0")}`);
			}
			/*
			#1641 **3 つ揃っても最後まで送る。** オーナー要望「3 PF の権利分岐ごとに
			どんなレイアウトになるかエビデンスで確認したい」。途中で抜けると、
			**埋め込み不可の YouTube のセルまで辿り着かない**（実際に run 33167111834 で
			撮り逃した）。`observeCurrentCell` は全部揃った時点で待たずに戻るので、
			残りのセルは 1 周ぶん（約 1.5 秒）しか掛からない。
			*/
			await swipeFeed();
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
			/*
			**「着けなかった」と「着いたが再生しない」を分けて書く。** 前者はフィードの送りが
			止まっている（＝ 再生の実装ではなく導線の問題）で、後者だけが再生の問題である。
			*/
			const neverReached = notPlayed.filter((provider) => !reachedBy[provider]);
			const reachedButSilent = notPlayed.filter((provider) => reachedBy[provider]);
			throw new Error(
				`アプリ内で再生が始まらなかった provider: ${notPlayed.join(", ")}。` +
					` 内訳 → セルへ一度も着けなかった: ${neverReached.join(", ") || "なし"}` +
					` / 着いたが再生しなかった: ${reachedButSilent.join(", ") || "なし"}。` +
					`（観測した埋め込みセル ${embedCells} 件 / 再生できた: ${
						PROVIDERS.filter((p) => playedBy[p]).join(", ") || "なし"
					}）。` +
					" 判定は external-embed-playing-{provider}（ページ内から «再生が始まった» と報告があったときだけ出る印）で行っている。" +
					" «着けなかった» 側は、フィードの送りが途中で止まっている疑いが濃い（権利ブロックのセルで実際に起きた）。",
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
