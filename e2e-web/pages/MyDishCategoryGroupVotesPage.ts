import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🗳 「グループ投票の履歴」一覧画面の Page Object（#1505）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/dish-category-group-votes.tsx
 *
 * 自分が **主催した** 友達投票セッションの一覧（参加しただけの投票は API 側で除かれる）。
 * マイページの `settings-my-group-votes` 行（#1402 で設定画面が廃止され、設定項目は
 * マイページの縦リストへ統合された）から遷移できるが、URL 直遷移でも到達できるため
 * blocked-topics と同じ流儀で直接 goto する。
 *
 * ## 行の掴み方
 * 行は全て同じ testID（`me-dish-category-group-votes-item`）を持つ。**session id を
 * 含めない**のは、実データで検証する Detox 側が id を知らずに行を掴めるようにするため。
 * 区別は「上から何番目か」（`item(index)`）か「行内のテキスト」（`itemByText`）で行う。
 *
 * ## 状態（投票済み / 未投票）の観測点
 * #1505 のデザイン再設計でテキストバッジは廃止した。画面上の表現は
 * 「未投票の行にだけ出る控えめなドット」（`me-dish-category-group-votes-item-unvoted`）で、
 * 「未投票」という語そのものは行の `aria-label` が持つ。どちらも検証できるように
 * `unvotedDot()` と、行の aria-label を見る `expectStatusInAccessibleName()` を用意した。
 */
export class MyDishCategoryGroupVotesPage {
	readonly page: Page;
	/** ヘッダーのタイトル（ScreenHeader が `${testID}-title` を付与） */
	readonly headerTitle: Locator;
	/** 0 件時の空表示（既存 testID） */
	readonly emptyState: Locator;
	/** 0 件時の CTA（EmptyState が `${testID}-action` を付与） */
	readonly emptyAction: Locator;

	constructor(page: Page) {
		this.page = page;
		this.headerTitle = page.getByTestId("me-dish-category-group-votes-header-title");
		this.emptyState = page.getByTestId("me-dish-category-group-votes-empty-state");
		this.emptyAction = page.getByTestId("me-dish-category-group-votes-empty-state-action");
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/dish-category-group-votes`);
	}

	/** 画面が表示されていることを検証する */
	async expectLoaded(): Promise<void> {
		await expect(this.headerTitle).toBeVisible();
	}

	/** 0 件時の空表示が出ていることを検証する */
	async expectEmpty(): Promise<void> {
		await expect(this.emptyState).toBeVisible();
	}

	/** すべての行 */
	get items(): Locator {
		return this.page.getByTestId("me-dish-category-group-votes-item");
	}

	/** 上から index 番目（0 始まり）の行 */
	item(index = 0): Locator {
		return this.items.nth(index);
	}

	/** 行内に指定テキスト（勝者名・候補名の要約など）を含む行 */
	itemByText(text: string): Locator {
		return this.items.filter({ hasText: text });
	}

	/** 行の 1 行目（勝者名 or 候補名の要約） */
	itemTitle(index = 0): Locator {
		return this.item(index).getByTestId("me-dish-category-group-votes-item-title");
	}

	/** 未投票を示すドット。投票済みの行には存在しない */
	unvotedDot(row: Locator): Locator {
		return row.getByTestId("me-dish-category-group-votes-item-unvoted");
	}

	/** 行の読み上げ名（aria-label）に「いつ・何の投票・状態」が入っていることを検証する */
	async expectAccessibleName(row: Locator, pattern: RegExp): Promise<void> {
		await expect(row).toHaveAttribute("aria-label", pattern);
	}

	/** 指定した行をクリックして投票結果画面へ遷移する */
	async openItem(index = 0): Promise<void> {
		await this.item(index).click();
	}
}
