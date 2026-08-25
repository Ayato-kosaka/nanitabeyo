import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🃏 トピック提案画面(検索結果のカードカルーセル)の Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/search/dish-categories.tsx
 *
 * 検索実行後、AI が提案する料理トピックのカードがカルーセル表示される。
 * カードは reanimated ベースのスワイプ UI のため、Web ではクリック/タップ操作を優先する。
 *
 * 注意: expo-router の静的書き出し環境ではタブグループ内のネスト遷移で
 * ブラウザの URL バーが実際の表示内容と一致しないことがある(既知の挙動)。
 * そのため画面遷移の検証は URL ではなく画面固有のテキスト/要素で行う。
 */
export class DishCategoriesPage {
	readonly page: Page;
	/** 画面ヘッダのタイトル文字列(ja-JP: DishCategories.headerTitle) */
	readonly headerTitle: Locator;
	/** 1 枚目のトピックカードの選択ボタン(ja-JP: DishCategories.chooseThis) */
	readonly chooseThisButton: Locator;
	/**
	 * トピックカードの選択ボタン(絞り込み無し)。
	 * 連打テストのように **画面が複数積み上がりうる**状況で `.last()` を取るために使う。
	 */
	private readonly chooseThisButtons: Locator;
	/** ヘッダーの「？」再表示ボタン */
	readonly tutorialHelpButton: Locator;
	/** ヘッダーの「友達投票開始」ボタン（#1205 の連打対象） */
	readonly groupVoteButton: Locator;
	/** スポットライトを含む最前面オーバーレイ */
	readonly tutorialOverlay: Locator;
	readonly tutorialNextButton: Locator;
	readonly tutorialFinishButton: Locator;
	readonly tutorialSkipButton: Locator;
	readonly tutorialSwipeStep: Locator;
	readonly tutorialDeepDiveStep: Locator;
	readonly tutorialActionsStep: Locator;
	readonly tutorialGroupVoteStep: Locator;
	/** #1499 取得失敗時のエラーカード全体 */
	readonly errorCard: Locator;
	/** #1499 失敗時のエラー文言 */
	readonly errorMessage: Locator;
	/** #1499 「その場で再試行」ボタン */
	readonly errorRetryButton: Locator;
	/** #1499 エラーカードの「戻る」ボタン */
	readonly errorBackButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.headerTitle = page.getByText("あなたにおすすめの料理", { exact: true });
		this.chooseThisButtons = page.getByText("この料理にする！", { exact: true });
		this.chooseThisButton = this.chooseThisButtons.first();
		this.tutorialHelpButton = page.getByTestId("dish-categories-tutorial-help");
		this.groupVoteButton = page.getByTestId("dish-categories-group-vote");
		this.tutorialOverlay = page.getByTestId("dish-categories-tutorial-overlay");
		this.tutorialNextButton = page.getByTestId("dish-categories-tutorial-next");
		this.tutorialFinishButton = page.getByTestId("dish-categories-tutorial-finish");
		this.tutorialSkipButton = page.getByTestId("dish-categories-tutorial-skip");
		this.tutorialSwipeStep = page.getByTestId("dish-categories-tutorial-step-swipeAndDecide");
		this.tutorialDeepDiveStep = page.getByTestId("dish-categories-tutorial-step-deepDive");
		this.tutorialActionsStep = page.getByTestId("dish-categories-tutorial-step-dishCategoryActions");
		this.tutorialGroupVoteStep = page.getByTestId("dish-categories-tutorial-step-groupVote");
		this.errorCard = page.getByTestId("dish-categories-error");
		this.errorMessage = page.getByTestId("dish-categories-error-message");
		this.errorRetryButton = page.getByTestId("dish-categories-error-retry");
		this.errorBackButton = page.getByTestId("dish-categories-error-back");
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
	async chooseFirstDishCategory(): Promise<void> {
		await this.chooseThisButton.click();
	}

	/** 初回または「？」経由で、ステップ1が表示されるまで待つ。 */
	async expectTutorialStarted(): Promise<void> {
		await expect(this.tutorialOverlay).toBeVisible({ timeout: 10_000 });
		await expect(this.tutorialSwipeStep).toBeVisible();
	}

	/**
	 * #1499 取得失敗時のエラー画面(DishCategoriesError)が表示され、再試行ボタンが押せる状態であることを検証する。
	 *
	 * トピック生成は実測で時間がかかりうるため、失敗確定までのタイムアウトも長めに取る
	 * (dish-categories-flow.spec.ts の DISH_CATEGORIES_TIMEOUT 相当の考え方)。
	 */
	async expectErrorState(): Promise<void> {
		await expect(this.errorCard).toBeVisible({ timeout: 30_000 });
		await expect(this.errorRetryButton).toBeEnabled();
	}

	/** #1499 再試行ボタンを押す */
	async retry(): Promise<void> {
		await this.errorRetryButton.click();
	}
}
