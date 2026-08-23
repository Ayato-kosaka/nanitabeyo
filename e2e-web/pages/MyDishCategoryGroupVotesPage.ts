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
 * ## 行に testID が無い理由
 * `VoteListItem`（画面側コンポーネント）は `accessibilityRole="link"` /
 * `accessibilityLabel={formattedDate}` しか持たない（testID 無し）。そのため行の特定は
 * `getByRole("link", { name: <表示日付> })` で行う。表示日付は
 * `new Date(createdAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })`
 * で決まるため、モックする `createdAt` から同じ式で計算すること（spec 側の `formatItemDate` 参照）。
 */
export class MyDishCategoryGroupVotesPage {
	readonly page: Page;
	/** ヘッダーのタイトル（ScreenHeader が `${testID}-title` を付与） */
	readonly headerTitle: Locator;
	/** 0 件時の空表示（既存 testID） */
	readonly emptyState: Locator;

	constructor(page: Page) {
		this.page = page;
		this.headerTitle = page.getByTestId("me-dish-category-group-votes-header-title");
		this.emptyState = page.getByTestId("me-dish-category-group-votes-empty-state");
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

	/** 表示日付（accessibilityLabel）で 1 件分の行を特定する */
	item(accessibleDateLabel: string): Locator {
		return this.page.getByRole("link", { name: accessibleDateLabel });
	}

	/** 指定した行をクリックして投票結果画面へ遷移する */
	async openItem(accessibleDateLabel: string): Promise<void> {
		await this.item(accessibleDateLabel).click();
	}
}
