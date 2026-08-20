import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🍽️ 「食べたい/食べた」タブの Page Object（#1396 でレビュータブから差し替え）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/my-dishes/index.tsx
 *
 * 表示内容はログイン状態で分岐する:
 * - 匿名ユーザー: ゲスト向け説明 + ログイン CTA（MyDishes.guest.*）
 * - ログイン済み: 3 ビュー（Map/リスト/Calendar）の shell + 記録 CTA（MyDishes.record.cta）
 *
 * ## PR2（#1396）時点のスコープ
 * 3 ビューの中身は shell（空のプレースホルダー）のため、ここではゲスト表示と
 * 記録 CTA（旧 `ReviewPage.postReviewButton` の後継。#1396 でクラスごと差し替え）のみを扱う。
 */
export class MyDishesPage {
	readonly page: Page;
	/** 匿名ユーザー向けのゲスト説明文（testID: my-dishes-guest-description） */
	readonly guestDescription: Locator;
	/** 匿名ユーザー向けのログイン CTA ボタン（testID: my-dishes-guest-login-button） */
	readonly guestLoginButton: Locator;
	/** ログイン済みユーザー向けの記録 CTA（testID: my-dishes-record-button） */
	readonly recordButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.guestDescription = page.getByTestId("my-dishes-guest-description");
		this.guestLoginButton = page.getByTestId("my-dishes-guest-login-button");
		this.recordButton = page.getByTestId("my-dishes-record-button");
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/my-dishes`);
	}

	/** 匿名ユーザー向けのゲスト表示が出ていることを検証する */
	async expectGuestViewLoaded(): Promise<void> {
		await expect(this.guestDescription).toBeVisible();
	}

	/** ログイン済みユーザー向けの記録 CTA が出ていることを検証する */
	async expectAuthenticatedViewLoaded(): Promise<void> {
		await expect(this.recordButton).toBeVisible();
	}
}
