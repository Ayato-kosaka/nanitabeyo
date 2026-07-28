import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🃏 トピック提案画面(検索結果のカードカルーセル)の Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/search/topics.tsx
 *
 * 検索実行後、AI が提案する料理トピックのカードがカルーセル表示される。
 * カードは reanimated ベースのスワイプ UI のため、Web ではクリック/タップ操作を優先する。
 *
 * 注意: expo-router の静的書き出し環境ではタブグループ内のネスト遷移で
 * ブラウザの URL バーが実際の表示内容と一致しないことがある(既知の挙動)。
 * そのため画面遷移の検証は URL ではなく画面固有のテキスト/要素で行う。
 */
export class TopicsPage {
	readonly page: Page;
	/** 画面ヘッダのタイトル文字列(ja-JP: Topics.headerTitle) */
	readonly headerTitle: Locator;
	/** 1 枚目のトピックカードの選択ボタン(ja-JP: Topics.chooseThis) */
	readonly chooseThisButton: Locator;
	/** ヘッダーの「？」再表示ボタン */
	readonly tutorialHelpButton: Locator;
	/** スポットライトを含む最前面オーバーレイ */
	readonly tutorialOverlay: Locator;
	readonly tutorialNextButton: Locator;
	readonly tutorialFinishButton: Locator;
	readonly tutorialSkipButton: Locator;
	readonly tutorialSwipeStep: Locator;
	readonly tutorialDeepDiveStep: Locator;
	readonly tutorialActionsStep: Locator;
	readonly tutorialGroupVoteStep: Locator;

	constructor(page: Page) {
		this.page = page;
		this.headerTitle = page.getByText("あなたにおすすめの料理", { exact: true });
		this.chooseThisButton = page.getByText("この料理にする！", { exact: true }).first();
		this.tutorialHelpButton = page.getByTestId("topics-tutorial-help");
		this.tutorialOverlay = page.getByTestId("topics-tutorial-overlay");
		this.tutorialNextButton = page.getByTestId("topics-tutorial-next");
		this.tutorialFinishButton = page.getByTestId("topics-tutorial-finish");
		this.tutorialSkipButton = page.getByTestId("topics-tutorial-skip");
		this.tutorialSwipeStep = page.getByTestId("topics-tutorial-step-swipeAndDecide");
		this.tutorialDeepDiveStep = page.getByTestId("topics-tutorial-step-deepDive");
		this.tutorialActionsStep = page.getByTestId("topics-tutorial-step-topicActions");
		this.tutorialGroupVoteStep = page.getByTestId("topics-tutorial-step-groupVote");
	}

	/** トピック提案画面が表示されていることを検証する */
	async expectLoaded(): Promise<void> {
		await expect(this.headerTitle).toBeVisible({ timeout: 30_000 });
		await expect(this.chooseThisButton).toBeVisible({ timeout: 30_000 });
	}

	/** 先頭のトピックカードを選択する */
	async chooseFirstTopic(): Promise<void> {
		await this.chooseThisButton.click();
	}

	/** 初回または「？」経由で、ステップ1が表示されるまで待つ。 */
	async expectTutorialStarted(): Promise<void> {
		await expect(this.tutorialOverlay).toBeVisible({ timeout: 10_000 });
		await expect(this.tutorialSwipeStep).toBeVisible();
	}
}
