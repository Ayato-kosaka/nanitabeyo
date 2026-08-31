import {
	by,
	describeMutation,
	device,
	element,
	existsNow,
	launchAppWithSession,
	tapWhenVisible,
	waitFor,
	waitUntilVisible,
} from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";
import { ensureExternalEmbedImported } from "../../utils/externalEmbedImport";
import { readSessionFromEnv } from "../../utils/sessionEnv";

/**
 * 🔇 グリッド → カード → フィードで **2 つのセルが同時に鳴らない** @mutation（#1641）
 *
 * ## なぜこの spec が要るのか（この経路を通る e2e が 1 本も無かった）
 *
 * オーナー実機報告（2026-08-31）:
 *
 * > ポンデポチャ押したらインスタの音聞こえる / インスタおしたらYouTubeの音聞こえる
 *
 * 真因は **押したカードの «隣のページ» が先読みで «前面» 扱いになり、そのまま鳴っていた**こと。
 * `MyDishesFeedPage` の描画の門は `isActive` を見ておらず、先読みで `entriesKey` が
 * 埋まった瞬間に `DishMediaFeed` が描かれる。グリッド由来のページは **1 ページ = 1 件**なので、
 * その中では常に `index(0) === currentIndex(0)` ＝ **マウントした瞬間に前面扱いで鳴り出す**。
 * 修正は `isScreenActive` を下へ伝えることで、既に入っている（commit `dc68680a`）。
 *
 * **しかし、この経路を通る e2e が 1 本も無かった。**
 * 既存の `external-embed-feed.test.ts` は `restaurant/{id}/feed` へ**ディープリンクで直接入る**ので、
 *
 * - «一覧（グリッド）のセルを押す» を一度も通らない
 * - したがって **外側の縦ページャ（`my-dishes-feed-pager`）と、その先読みを一度も踏まない**
 *
 * つまり CI が緑でも、今回の不具合は **原理的に検出できなかった**。この spec は
 * その欠けている経路（食べたい/食べた → グリッド → 埋め込みカード → 全画面フィード）だけを通す。
 *
 * ## 何を合否にするか
 *
 * 合否は **`external-embed-playing-{provider}` が同時に 2 つ以上出ていないこと**の一点。
 * この印は `ExternalEmbedPlayer` が `playback === "playing"` のときだけ描く寸法ゼロの View で、
 * かつ **前面でないセルはコンポーネントごと `return null`** になる。したがって
 * «印が 2 つ同時に在る» ＝ «2 つのセルが同時に前面で鳴っている» と言い切れる。
 *
 * ⚠️ **`external-embed-cell-{provider}` は合否に使わない。** あれは «そのセルに着いた» 印であって
 *    «鳴っている» 印ではない。ただし «同時に 2 つマウントされている» の手がかりにはなるので、
 *    観測結果は run のログへ残す（診断専用。落とさない）。
 *
 * ⚠️ **«印が出るまで待つ» だけの spec にしない。** それでは «鳴っている» を確かめただけで、
 *    «もう 1 つ鳴っていない» は一度も見ていないことになる。この spec は
 *    **ページに居る間ずっと 0.5 秒おきに印を数え続け、2 つ見えた瞬間に落ちる**。
 *
 * ## dev DB への書き込み（@mutation の理由）
 * beforeAll がテストユーザーとして SNS 取り込み（resolve → create）を実行する。
 * create はサービス側が冪等なので、2 回目以降は «テストユーザーの食べたい» を保証するだけの読み等価。
 */
describeMutation("グリッドから開いたフィードで 2 つのセルが同時に鳴らない @mutation", () => {
	const tabBar = new TabBar();
	const myDishes = new MyDishesScreen();

	/** 判定に使う provider。`ExternalEmbedPlayer` が印を provider ごとに分けて出す */
	const PROVIDERS = ["instagram", "tiktok", "youtube"] as const;

	/**
	 * グリッドの «埋め込みのカード»。
	 *
	 * 取り込み元のロゴ（`my-dishes-list-item-provider-badge`）は
	 * `dishMedia.render_type === "external_embed"` の行にだけ載る（`MyDishesListView.tsx`）。
	 * カード自身（`my-dishes-list-item`）には行を区別する testID が無いので、
	 * **ロゴを子に持つカード**という形で指す。押すのはカードの方（ロゴは飾りで押す物ではない）。
	 */
	/*
	#1641 ⚠️ **踏むのは «鳴る投稿» のカードにすること。**

	実測（run 33403385170）: provider を問わず «取り込み元ロゴのあるカード» を踏んでいたら、
	**映像を持たない Instagram の素材**（DZFdePPzzLI）に当たり、再生を 1 度も観測しないまま
	«同時再生なし» と判定していた。鳴っていないものが 2 つ同時に鳴ることはないので、
	その run は **何も起きなくても緑**だった。

	TikTok の素材は CI のほぼ全 run で鳴っている（`external_embed_autoplay_started`）ので、
	入口として最も確実である。バッジの testID に provider が入っているのはこのため。
	*/
	const embedCard = by
		.id("my-dishes-list-item")
		.withDescendant(by.id("my-dishes-list-item-provider-badge-tiktok"));

	/**
	 * 印 1 つを読むときの上限 (ms)。
	 * 既定の 2 秒だと 3 provider を 1 周するだけで 6 秒かかり、同時再生の «瞬間» を取りこぼす。
	 */
	const MARKER_PROBE_MS = 500;

	/**
	 * 1 ページに留まって印を数え続ける時間 (ms)。
	 *
	 * `external-embed-feed.test.ts` の `CELL_DWELL_MS` と同じ値・同じ根拠にしてある。
	 * 埋め込みが «前面に来てから結論を出すまで» の実測はこう（すべて iOS シミュレータ）:
	 *
	 * | 何 | 前面から | run |
	 * | --- | --- | --- |
	 * | youtube 再生 | **34348ms** | 33345690986 |
	 * | youtube 再生 | 27681ms | 33351477331 |
	 * | tiktok 時間切れ | 23154ms | 33348354215 |
	 *
	 * ⚠️ **短くしてはいけない。** 先読みされた隣のページが鳴り出すまでの時間も同じオーダーなので、
	 *    ここを詰めると «まだ鳴っていないだけ» を «鳴っていない» と読み、不具合を素通りする。
	 * ⚠️ **長くもしない。** これ以上掛かるなら «遅い» ではなく «何かが起きている» ので、
	 *    予算ではなくログを読む（同 spec の注記と同じ方針）。
	 */
	const PAGE_WATCH_MS = 42_000;

	/**
	 * 押したカードのページで «埋め込みのセルに着いた» を待つ上限 (ms)。
	 *
	 * ページは `GET /v1/dish-media?ids=` の往復を挟んでから `DishMediaFeed` を描く。
	 * 印そのものは読み込みを待たずに出る（`external-embed-cell-*` は再生可否で括られていない）ので、
	 * ここで待っているのは **API の往復ぶん**だけである。
	 */
	const FIRST_CELL_TIMEOUT_MS = 60_000;

	/** 縦に送るページ数（往路 / 復路）。復路はオーナー報告 3 件目「上へスクロールしても鳴り続ける」用 */
	const FORWARD_PAGES = 3;
	const BACKWARD_PAGES = 2;

	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	/**
	 * 同じ testID の印が **何枚出ているか**を数える（0 / 1 / 2 以上）。
	 *
	 * ⚠️ **index を省いて数えてはいけない。** Detox は同じ matcher が複数一致すると例外になり
	 * （`matches 2 views in the hierarchy`）、`existsNow` はそれを false へ潰す（`utils/waits.ts`）。
	 * つまり **いちばん見つけたい «2 枚同時に出ている» 状態が «0 枚» に化ける**。
	 * 必ず `atIndex` を明示して 1 枚ずつ数える。
	 */
	const countMarkers = async (testId: string): Promise<number> => {
		if (!(await existsNow(by.id(testId), MARKER_PROBE_MS, 0))) return 0;
		if (!(await existsNow(by.id(testId), MARKER_PROBE_MS, 1))) return 1;
		return 2;
	};

	/** いま «再生中» の印がどれだけ出ているかを読む。戻り値は人が読める並び（例: `["tiktok", "youtube"]`） */
	const readPlaying = async (): Promise<string[]> => {
		const found: string[] = [];
		for (const provider of PROVIDERS) {
			const count = await countMarkers(`external-embed-playing-${provider}`);
			// 同じ provider が 2 枚同時に鳴る（隣のページも Instagram だった）場合も取りこぼさない
			for (let i = 0; i < count; i++) found.push(i === 0 ? provider : `${provider}(${i + 1}枚目)`);
		}
		return found;
	};

	/** いま «埋め込みのセルに着いている» 印がどれだけ出ているかを読む（**診断専用**。合否に使わない） */
	const readCells = async (): Promise<string[]> => {
		const found: string[] = [];
		for (const provider of PROVIDERS) {
			const count = await countMarkers(`external-embed-cell-${provider}`);
			for (let i = 0; i < count; i++) found.push(i === 0 ? provider : `${provider}(${i + 1}枚目)`);
		}
		return found;
	};

	/** run 全体で観測したもの（失敗文と最後のログに載せる） */
	const playingSeen: string[] = [];
	const cellsSeen: string[] = [];
	/** 診断: «2 つ以上のセルが同時にマウントされていた» のを見たページ（落としはしない） */
	const multiMountedPages: string[] = [];

	/**
	 * いまのページに留まって、**同時に 2 つ鳴っていないか**を数え続ける。
	 *
	 * ⚠️ «1 つ鳴ったから合格» で抜けない。隣のページが鳴り出すのは **こちらが鳴った後**のことが多く、
	 *    早く抜けるとその瞬間を見ない。窓の最後まで数える。
	 */
	const watchPage = async (label: string): Promise<void> => {
		const deadline = Date.now() + PAGE_WATCH_MS;
		for (;;) {
			const playing = await readPlaying();
			for (const name of playing) playingSeen.push(`${label}:${name}`);

			/*
			⚠️ **合否はこの 1 枚だけで決める。**

			以前は `external-embed-playing-*` の印を «2 枚数える» ことを合否にしていた。
			ところが同じ testID がビューツリーへ二重に現れることがあり
			（`utils/waits.ts` の `target()` のコメントにあるとおり、このリポジトリで既知の現象）、
			**1 つしか鳴っていないのに赤になった**。

			実測（run 33414862377 / 528f3813）: Detox は «tiktok が 2 枚» と数えたのに、
			アプリ側のログは
			  - `dish_media_active_cell` が 1 件（entriesKey は 1 つ / total=1）
			  - `external_embed_autoplay_started` が 1 件
			  - `external_embed_concurrent_playing` が **0 件**（この行は即時送信なので消えない）
			の 3 つとも «1 つしか鳴っていない» を指していた。

			そこで数を «外から数える» のをやめ、**アプリ自身が数えた結果**を見る。
			`external-embed-concurrent-playing` は、ExternalEmbedPlayer が
			«自分が鳴っている最中に他のセルも鳴っている» と判定したときだけ描く印である。
			1 枚でも在れば本当に同時再生であり、二重に現れても結論は変わらない。
			*/
			if (await existsNow(by.id("external-embed-concurrent-playing"), MARKER_PROBE_MS, 0)) {
				// 落ちる前に «その瞬間» を残す。オーナーへ見せるのは失敗文ではなくこのコマである
				await device.takeScreenshot(`concurrent-playback-${label}`);
				throw new Error(
					`【同時再生】${label} で、アプリ自身が «2 つ以上のセルが同時に鳴っている» と判定しました。` +
						` 参考（外から数えた印。二重計上しうるので合否には使っていない）: ${playing.join(", ") || "なし"}。` +
						" オーナー報告「ポンデポチャ押したらインスタの音聞こえる / インスタおしたら YouTube の音聞こえる」と同じ症状です。" +
						" どのセルとどのセルだったかは BigQuery の external_embed_concurrent_playing（両方の contentId 入り）を見てください。" +
						` 撮ったコマは concurrent-playback-${label} を参照。`,
				);
			}

			if (Date.now() >= deadline) return;
			await sleep(500);
		}
	};

	/**
	 * フィードを 1 ページ送る。
	 *
	 * ⚠️ **ページャのコンテナを直接掴めない。** 埋め込みが前面にいる間は WebView が画面を覆い、
	 * iOS の Detox が要求する «100% 見えていること» を満たせずに
	 * `View does not pass visibility percent threshold (100)` で落ちる
	 * （`external-embed-feed.test.ts` に run 33064372163 の実測がある）。
	 * 覆っている当のものの上から払う。覆いは指を通す（WebView は `pointerEvents="none"`）ので、
	 * 指はそのまま下のページャへ抜ける。
	 */
	const swipeFeed = async (direction: "up" | "down"): Promise<void> => {
		const candidates = [
			by.id("external-embed-webview"),
			by.id("external-embed-fallback"),
			by.id("my-dishes-feed-pager"),
		];
		let target = candidates[candidates.length - 1];
		for (const candidate of candidates) {
			// 同時再生が起きていると WebView が 2 枚在りうるので、ここも index を明示して探す
			if (await existsNow(candidate, MARKER_PROBE_MS, 0)) {
				target = candidate;
				break;
			}
		}
		await element(target).atIndex(0).swipe(direction, "fast", 0.6, 0.5, 0.5);
		// 送り終わり（onMomentumScrollEnd）で activeScopeIndex が動く。落ち着くまで少しだけ待つ
		await sleep(1_500);
	};

	beforeAll(async () => {
		const session = readSessionFromEnv("authenticated");
		if (!session) {
			throw new Error("認証済みセッションが無いため、グリッドに並べる埋め込みの記録を用意できません。");
		}
		/*
		グリッドに **埋め込みのカードを 2 つ以上**並べたい。1 つしか無いと、押したカードの
		隣が普通の動画になり、«隣が鳴っている» を印で捕まえられない（音は鳴っても印が出ない）。
		取り込みは同じタイミングで作られるので、グリッド上でも近くに並ぶ。

		⚠️ 埋め込みを増やしすぎない。5 本並べたところで Android が `lowmemorykiller` で
		   アプリを殺した実績がある（run 33133043261）。ここは 3 provider ぶんに留める。
		*/
		await ensureExternalEmbedImported(session.accessToken, {
			alsoImportPlayable: true,
			alsoImportOtherProviders: true,
		});
	});

	// 同じ run の後続 spec を «同期の切れた» 状態へ持ち越さない
	afterAll(async () => {
		await device.enableSynchronization();
	});

	it("埋め込みカードから開いたフィードは、縦に送っても常に 1 つしか鳴らない", async () => {
		await launchAppWithSession({ as: "authenticated" });

		// 1. 食べたい/食べた → リスト（グリッド）
		await tabBar.gotoMyDishes();
		await myDishes.selectView("list");
		// 一覧は約 964MB の `dish_reviews` を引くので、初回は既定のタイムアウトでは足りない
		await waitUntilVisible(by.id("my-dishes-list"), 120_000);

		/*
		2. **埋め込みのカードを探す。** 取り込みが古いユーザーだと先頭付近には居ないので、
		   グリッドを送りながら探す。見つからないのは «取り込みが一覧に出ていない» ということなので、
		   その旨で落とす（合否をここで曖昧にしない）。
		*/
		try {
			await waitFor(element(embedCard).atIndex(0))
				.toBeVisible()
				.whileElement(by.id("my-dishes-list"))
				.scroll(320, "down");
		} catch (error) {
			throw new Error(
				"グリッドに «TikTok の取り込みカード» が 1 つも見つかりませんでした。" +
					" beforeAll の取り込みは成功しているので、一覧（GET /v1/users/me/dishes）に出ていないか、" +
					" ロゴのバッジ（my-dishes-list-item-provider-badge）が描かれていない疑いがあります。" +
					`（元の失敗: ${error instanceof Error ? error.message : String(error)}）`,
			);
		}

		/*
		3. **押す前に Detox の同期機構を切る。**

		フィードへ着いた瞬間から埋め込みは鳴り続けるので、アプリは二度と «暇» にならない。
		同期を有効にしたまま操作を続けると、アプリではなく待ち方の理由で落ちる
		（`external-embed-feed.test.ts` の run 33065565293 で実測。同じ run の失敗時スクショには
		フィードもリールも正しく写っていた）。この spec は画面を眺めて印を数えるだけで、
		操作のタイミングに依存しないので、明示的に待つ形へ倒すのが正しい。
		*/
		await device.disableSynchronization();
		await tapWhenVisible(embedCard, 30_000, 0);

		/*
		4. 全画面フィードへ着地。**可視ではなく «在るか» で待つ。**
		   埋め込みが前面に来ると全画面の WebView が画面を覆い、iOS の `toBeVisible()` は
		   永久に真にならない（覆われている View 自身の画素が見えないため）。
		*/
		if (!(await existsNow(myDishes.feedScreen, 120_000))) {
			throw new Error("グリッドのカードを押しても全画面フィード（my-dishes-feed-screen）へ着けませんでした。");
		}
		await device.takeScreenshot("grid-feed-00-arrived");

		/*
		5. **押したカードのページが埋め込みのセルであること**を確かめる。

		埋め込みのカードを押したのだから、着いた先も埋め込みでなければならない。ここが空なら
		グリッドの行 → フィードのページの対応が壊れている（= この spec が見たい経路そのものが死んでいる）。
		「印が出るまで待つだけ」にならないよう、**合否の本体は次の watchPage** に置いてある。
		*/
		const firstCellDeadline = Date.now() + FIRST_CELL_TIMEOUT_MS;
		let firstCells: string[] = [];
		for (;;) {
			firstCells = await readCells();
			if (firstCells.length > 0 || Date.now() >= firstCellDeadline) break;
			await sleep(500);
		}
		if (firstCells.length === 0) {
			throw new Error(
				"埋め込みのカードを押したのに、開いたページが埋め込みのセルではありませんでした" +
					`（external-embed-cell-* が ${FIRST_CELL_TIMEOUT_MS / 1000} 秒出ませんでした）。` +
					" グリッドの行（itemKey）と フィードのページの対応が壊れている疑いがあります。",
			);
		}
		cellsSeen.push(`page-00:${firstCells.join("+")}`);
		if (firstCells.length > 1) multiMountedPages.push("page-00");

		/*
		6. **ここからが本題。** 着いたページと、そこから縦に送った先で
		   «同時に 2 つ鳴っていないか» を数え続ける。オーナーが踏んだのは
		   ① 押した直後（隣が先読みで鳴る）と ② 送った先 と ③ 上へ戻したとき の 3 つなので、
		   往路と復路の両方を通る。
		*/
		await watchPage("page-00");
		await device.takeScreenshot("grid-feed-page-00");

		for (let i = 1; i <= FORWARD_PAGES; i++) {
			const label = `page-${String(i).padStart(2, "0")}`;
			await swipeFeed("up");
			const cells = await readCells();
			if (cells.length > 0) cellsSeen.push(`${label}:${cells.join("+")}`);
			if (cells.length > 1) multiMountedPages.push(label);
			await watchPage(label);
			await device.takeScreenshot(`grid-feed-${label}`);
		}

		/*
		オーナー報告 3 件目:「YouTube から上へスクロール → YouTube の音が鳴り続ける」。
		戻る向きはページの作り直しが起きるので、片道では出ない形（前のページが鳴ったまま残る）を拾える。
		*/
		for (let i = 1; i <= BACKWARD_PAGES; i++) {
			const label = `back-${String(i).padStart(2, "0")}`;
			await swipeFeed("down");
			const cells = await readCells();
			if (cells.length > 0) cellsSeen.push(`${label}:${cells.join("+")}`);
			if (cells.length > 1) multiMountedPages.push(label);
			await watchPage(label);
			await device.takeScreenshot(`grid-feed-${label}`);
		}

		/*
		7. **アプリが生きていることを 1 つ検証する。** スワイプの後に assertion が無いと、
		   プロセスが死んでも緑で終わる。`existsNow` はビューツリーへ問い合わせるので、
		   アプリが消えていれば `rethrowIfAppIsGone` が例外を投げる（可視判定は使えない。上と同じ理由）。
		*/
		if (!(await existsNow(myDishes.feedScreen))) {
			throw new Error("縦に送ったあと全画面フィードが消えました（アプリが落ちた疑い）。");
		}

		/*
		⚠️ **1 度も鳴らなかった run を «合格» にしない。**

		実測（run 33397931157 / daf5660e）: この spec は **緑になったが、再生を 1 度も観測していなかった**。
		踏んだカードが «映像を持たない Instagram の素材» で、`no_video` へ縮退しただけだった。
		つまり «同時に 2 つ鳴っていないか» の判定は **一度も走っていない**。

		鳴っていないものが 2 つ同時に鳴ることはないので、この spec は
		**何も起きなくても必ず緑になる**構造だった。オーナーに «直った» と言うための
		根拠には使えない。緑の理由を確かめずに «直った» と書いて 5 回外している。

		⚠️ ここを «素材の都合で落とさない» に戻さないこと。素材が鳴らないなら、
		   直すのは spec の合否条件ではなく **素材の選び方**（鳴る投稿を踏むこと）である。
		*/
		if (playingSeen.length === 0) {
			await device.takeScreenshot("grid-feed-nothing-played");
			throw new Error(
				"【検証が成立していない】この run は再生を 1 度も観測していません。" +
					" «同時に 2 つ鳴っていないか» の判定が一度も走っていないので、緑にしてはいけません。" +
					` 着いたセル: ${cellsSeen.join(", ") || "なし"} /` +
					` 同時に 2 つ以上マウント: ${multiMountedPages.join(", ") || "なし"}。` +
					" 踏んだカードが «映像を持たない素材» だった可能性が高いので、" +
					" 鳴る投稿（externalEmbedImport の再生できる素材）を踏むように入口を選び直してください。" +
					" 撮ったコマは grid-feed-nothing-played を参照。",
			);
		}

		/*
		観測結果を run のログへ残す。**合否には使わない。**
		- `同時にマウント`: 2 つのセルが同時に在ること自体は «鳴っている» の証明ではないので落とさない。
		  ただし同時再生の一歩手前なので、数字として残す
		*/
		// eslint-disable-next-line no-console -- run のログへ残すことが目的
		console.log(
			`[grid-feed] 鳴った印: ${playingSeen.join(", ") || "なし"}\n` +
				`[grid-feed] 着いたセル: ${cellsSeen.join(", ") || "なし"}\n` +
				`[grid-feed] 同時に 2 つ以上マウントされていたページ: ${multiMountedPages.join(", ") || "なし"}`,
		);
	}, 900_000);
});
