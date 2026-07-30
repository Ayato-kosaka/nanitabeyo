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
	/**
	 * トピックカードの選択ボタン(絞り込み無し)。
	 * 連打テストのように **画面が複数積み上がりうる**状況で `.last()` を取るために使う。
	 */
	private readonly chooseThisButtons: Locator;
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
		this.chooseThisButtons = page.getByText("この料理にする！", { exact: true });
		this.chooseThisButton = this.chooseThisButtons.first();
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

	/**
	 * トピック提案画面の描画が終わる（カードが出る）まで待つ。枚数は問わない。
	 *
	 * #1084 P1 の連打テスト用。二重 push が起きていると `headerTitle` が複数一致して
	 * {@link expectLoaded} が strict mode 違反で落ち、
	 * 「何枚積み上がったか」という本来見たい情報がレポートに出ない。
	 * ここは待つだけに徹し、判定は枚数のアサーション（{@link stackedScreens}）へ委ねる。
	 *
	 * ⚠️ #1086 `.first()` ではなく `.last()` で待つこと。積み上がったスタックのうち
	 * **見えているのは最後に push された最前面の画面だけ**で、`.first()` は最下層の
	 * 隠れた画面を指してしまう（連打事故が起きているときに「見えない」で 30 秒
	 * タイムアウトし、失敗の理由が「二重に積まれた」ではなく「表示されない」になる）。
	 */
	async expectRenderedAllowingDuplicates(): Promise<void> {
		await expect(this.headerTitle.last()).toBeVisible({ timeout: 30_000 });
		await expect(this.chooseThisButtons.last()).toBeVisible({ timeout: 30_000 });
	}

	/**
	 * 積み上がっているトピック画面の枚数（#1084 P1 の主観測点）。
	 *
	 * React Navigation の push は同一 params でも常に新しいスクリーンを積み、
	 * web では前の画面も DOM に残る。したがって `router.push` が二重に走れば
	 * この見出しが 2 件一致する。`window.history.length` の増分は二重 push でも 1 のままで
	 * 検知できないため（#1086 で実測）、枚数をこの位置づけで使う。
	 */
	stackedScreens(): Locator {
		return this.headerTitle;
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
