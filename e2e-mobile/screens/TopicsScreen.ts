import {
	DEFAULT_TIMEOUT,
	by,
	existsNow,
	multiTapWhenPresent,
	tapWhenVisible,
	visibleNow,
	waitUntilGone,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * 🃏 トピック提案画面（検索結果のカードカルーセル）の Screen Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/search/topics.tsx
 * 対応する e2e-web の Page Object: e2e-web/pages/TopicsPage.ts
 *
 * ## 操作対象は「アクティブなカード」だけを指す testID で掴む（#1027）
 * カードは `react-native-reanimated-carousel` で描画され、**前後のカードも同時にマウントされる**。
 * そのため `topics-choose-button` は常に複数一致し、`atIndex(n)` で 1 つに絞る必要があるが、
 * **添字と「画面中央のカード」は対応しない**。添字を走査して可視なものを探す実装も試したが、
 * マウント数が走査上限を超えると成立せず、run 30432596949 / 30445542854 の topics-flow は
 * 2 テストとも 120 秒待って失敗し続けた。
 *
 * 現在は app-expo 側が **アクティブなカードにだけ** 付けている `topics-tutorial-target-select`
 *（`TopicCard.tsx`。`tutorialTargetRefs` は `isActiveCard` のときしか渡らない）を使う。
 * これは「いま操作できる 1 枚」と 1:1 で対応するため、添字の走査が要らない。
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
	// #1404 ScreenHeader の戻るボタンは `${testID}-back`。共通 id だった頃は、push で背面に残る
	// 画面のヘッダーと同じ id になり «背面を押していた»
	readonly backButton = by.id("topics-header-back");
	/**
	 * 「この料理にする！」ボタンを包む、**アクティブなカードにだけ存在する** View。
	 * app-expo の `TopicCard.tsx` が `tutorialTargetRefs`（= `isActiveCard` のときだけ渡る）を
	 * 受け取ったときにこの testID を出す。タップはこの View の中心に落ち、内側のボタンへ届く。
	 */
	readonly activeChooseButton = by.id("topics-tutorial-target-select");
	/** 「この料理にする！」ボタンそのもの（⚠️ 全カード分が一致するため観測点には使わない） */
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
			if (await visibleNow(this.activeChooseButton, 2_000)) return;
		}

		// 期限切れ。失敗理由（何が見えていないか）を Detox のメッセージとして残すため、最後に一度だけ待ち直す
		await waitUntilVisible(this.activeChooseButton);
	}

	/** アクティブなトピックカードを選択して結果フィードへ進む */
	async chooseFirstTopic(): Promise<void> {
		await tapWhenVisible(this.activeChooseButton);
	}

	/** ヘッダーの戻るボタンで検索画面へ戻る */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}

	/** ヘッダーの「友達投票開始」を押して投票結果画面へ進む */
	async openGroupVote(): Promise<void> {
		await tapWhenVisible(this.groupVoteButton);
	}

	/**
	 * 「友達投票開始」を **待機を挟まずに** 連打する（#1205）。
	 *
	 * `tap()` の連続では連打にならない理由は `multiTapWhenPresent` の JSDoc を参照
	 *（Android は Detox の同期機構が 1 発目の遷移とネットワーク完了まで待たせるため、
	 *  事故があっても緑になる）。
	 *
	 * @param times 連打回数
	 */
	async openGroupVoteRapid(times = 2): Promise<void> {
		await multiTapWhenPresent(this.groupVoteButton, times);
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
}
