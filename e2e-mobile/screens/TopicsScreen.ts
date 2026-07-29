import {
	DEFAULT_TIMEOUT,
	by,
	element,
	existsNow,
	tapWhenVisible,
	waitFor,
	waitUntilGone,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * 🃏 トピック提案画面（検索結果のカードカルーセル）の Screen Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/search/topics.tsx
 * 対応する e2e-web の Page Object: e2e-web/pages/TopicsPage.ts
 *
 * ## 「この料理にする！」ボタンに atIndex が要る理由（#1031 §2）
 * カードは `react-native-reanimated-carousel` で描画され、**前後のカードも同時にマウントされる**。
 * そのため `topics-choose-button` は常に複数一致しうる。Detox は複数一致した状態で
 * `element(matcher)` を操作すると例外になるため、必ず `atIndex(n)` で 1 つに絞る必要がある。
 *
 * ⚠️ #1027 【バグ】ただし **`atIndex(0)` が「画面中央の（= 操作したい）カード」とは限らない**。
 * カルーセルは前後のカードもマウントするため、添字 0 が画面外の隣接カードになることがあり、
 * `atIndex(0)` 決め打ちだと「カードは出ているのに toBeVisible が成立しない」で落ちる
 * （run 30432596949 の topics-flow はこれで 2 テストとも失敗した）。
 * そこで **添字を順に走査して「実際に見えている 1 つ」を選ぶ**（`findVisibleChooseButton()`）。
 *
 * ## スポットライトチュートリアルの扱い
 * この画面は初回訪問時にスポットライトチュートリアル（`topics-tutorial-overlay`）を自動表示する。
 * Modal として最前面に出るため、開いている間は背後のカードを Detox から操作できない。
 * `expectLoaded()` は「チュートリアルが出ていれば閉じてからカードを待つ」形にしてある。
 * チュートリアル自体の検証（e2e-web の topics-tutorial.spec.ts 相当）は本 PR のスコープ外。
 */
export class TopicsScreen {
	/** 画面ヘッダのタイトル（ScreenHeader の testID 由来。i18n: Topics.headerTitle） */
	readonly headerTitle = by.id("topics-header-title");
	/** ヘッダーの戻るボタン */
	readonly backButton = by.id("screen-header-back");
	/** 「この料理にする！」ボタン（⚠️ 複数一致するため必ず atIndex で絞ること） */
	readonly chooseButton = by.id("topics-choose-button");
	/** ヘッダーのグループ投票ボタン */
	readonly groupVoteButton = by.id("topics-group-vote");

	/** ヘッダーの「？」ボタン（チュートリアル再表示） */
	readonly tutorialHelpButton = by.id("topics-tutorial-help");
	/** スポットライトを含む最前面オーバーレイ */
	readonly tutorialOverlay = by.id("topics-tutorial-overlay");
	/** チュートリアルの「つぎへ」（最終ステップ以外） */
	readonly tutorialNextButton = by.id("topics-tutorial-next");
	/** チュートリアルの「使ってみる」（最終ステップ） */
	readonly tutorialFinishButton = by.id("topics-tutorial-finish");
	/** チュートリアルの「スキップ」（最終ステップ以外で描画される） */
	readonly tutorialSkipButton = by.id("topics-tutorial-skip");

	/**
	 * トピック生成待ちのタイムアウト (ms)。
	 *
	 * #1031 【設計】§4-1: 検索実行後の AI によるトピック生成は実測で数十秒かかる。
	 * e2e-web が topics-flow.spec.ts へ `test.setTimeout(90_000)` を置いているのと同じ位置づけで、
	 * ネイティブは実機/エミュレータの遅さを見込んでさらに余裕を持たせる。
	 */
	static readonly TOPICS_TIMEOUT = 120_000;

	/**
	 * 走査する `topics-choose-button` の添字の上限。
	 * `react-native-reanimated-carousel` が同時にマウントするカード数（中央 + 前後）を見込んだ値。
	 */
	private static readonly MAX_CAROUSEL_SLOTS = 5;

	/** チュートリアルのステップ要素（id は TopicsSpotlightTutorial のステップ id） */
	tutorialStep(id: string): Detox.NativeMatcher {
		return by.id(`topics-tutorial-step-${id}`);
	}

	/**
	 * トピック提案画面が表示され、カードが操作可能になるまで待つ。
	 *
	 * 「トピック生成の完了待ち」と「自動表示されるチュートリアルの解消」が同時に絡むため、
	 * どちらが先に起きても破綻しないよう **交互にポーリングする**形にしている。
	 *
	 * @param timeout タイムアウト (ms)。既定はトピック生成待ちを見込んだ TOPICS_TIMEOUT
	 * @失敗時 期限内にカードが表示されなければ Detox の例外を投げる
	 */
	async expectLoaded(timeout: number = TopicsScreen.TOPICS_TIMEOUT): Promise<void> {
		const deadline = Date.now() + timeout;

		while (Date.now() < deadline) {
			if (await existsNow(this.tutorialOverlay, 1_000)) {
				await this.dismissTutorialIfPresent();
				continue;
			}
			if ((await this.findVisibleChooseButton(2_000)) !== null) return;
		}

		// 期限切れ。失敗理由（何が見えていないか）を Detox のメッセージとして残すため、最後に一度だけ待ち直す
		await waitFor(this.chooseButtonAt(0)).toBeVisible().withTimeout(DEFAULT_TIMEOUT);
	}

	/**
	 * いま画面に見えているトピックカードを選択して結果フィードへ進む。
	 *
	 * @失敗時 見えているカードが 1 つも無ければ日本語メッセージで例外を投げる
	 */
	async chooseFirstTopic(): Promise<void> {
		const button = await this.findVisibleChooseButton(DEFAULT_TIMEOUT);
		if (button === null) {
			throw new Error(
				"トピックカードの「この料理にする！」(topics-choose-button) が、可視な添字を探しても見つかりませんでした。",
			);
		}
		await button.tap();
	}

	/** ヘッダーの戻るボタンで検索画面へ戻る */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}

	/**
	 * スポットライトチュートリアルが出ていれば閉じる（ベストエフォート）。
	 *
	 * 最終ステップではスキップ導線が消え「使ってみる」だけになるため、両方を見て閉じる。
	 *
	 * @returns 閉じた場合 true / そもそも出ていなかった場合 false
	 */
	async dismissTutorialIfPresent(): Promise<boolean> {
		if (!(await existsNow(this.tutorialOverlay, 1_000))) return false;

		if (await existsNow(this.tutorialSkipButton, 1_000)) {
			await tapWhenVisible(this.tutorialSkipButton);
		} else {
			await tapWhenVisible(this.tutorialFinishButton);
		}

		// #1031 【設計】§4-1: 閉じる動作は Reanimated のフェードアウトを伴うため、
		// 消えるまで明示的に待ってから次の操作へ進む
		await waitUntilGone(this.tutorialOverlay);
		return true;
	}

	/** ヘッダーのタイトルが表示されていることを検証する */
	async expectHeaderVisible(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
	}

	/** n 番目にマウントされたカードの「この料理にする！」ボタン */
	private chooseButtonAt(index: number): Detox.NativeElement {
		return element(this.chooseButton).atIndex(index);
	}

	/**
	 * 「この料理にする！」ボタンのうち **実際に見えている 1 つ**を探す。
	 *
	 * ⚠️ utils/waits.ts の `visibleNow` は index を省略すると `element(matcher)` を使うため、
	 * 複数一致する `topics-choose-button` にそのまま使うと「複数一致」の例外を
	 * 「見えていない」と誤判定してしまう。ここでは添字を明示して 1 つずつ判定する。
	 *
	 * @param timeout 添字 1 つあたりの判定に費やす上限 (ms)
	 * @returns 見えている要素 / 1 つも無ければ null
	 */
	private async findVisibleChooseButton(timeout: number): Promise<Detox.NativeElement | null> {
		for (let index = 0; index < TopicsScreen.MAX_CAROUSEL_SLOTS; index += 1) {
			const candidate = this.chooseButtonAt(index);
			try {
				await waitFor(candidate).toBeVisible().withTimeout(timeout);
				return candidate;
			} catch {
				// 「その添字は見えていない」だけなので次の添字へ進む
				//（添字が存在しない場合もここへ来るため、走査の終端としても機能する）
			}
		}
		return null;
	}
}
