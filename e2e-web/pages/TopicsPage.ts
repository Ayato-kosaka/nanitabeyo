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

	constructor(page: Page) {
		this.page = page;
		this.headerTitle = page.getByText("あなたにおすすめの料理", { exact: true });
		this.chooseThisButton = page.getByText("この料理にする！", { exact: true }).first();
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
}
