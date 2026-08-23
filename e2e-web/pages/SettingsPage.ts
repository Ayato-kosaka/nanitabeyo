import { expect, type Locator, type Page } from "@playwright/test";

/**
 * ⚙️ 設定画面の Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/settings.tsx
 *
 * - 「レビューを書く」（ストア誘導）は Web では非表示（Platform.OS !== "web" 条件）
 * - 「ログアウト」はログイン済み（非匿名）ユーザーのみ表示
 * - #1368 リーガル 4 行はモーダルではなく `/[locale]/legal/<doc>` へ遷移する。
 *   遷移先の検証は `pages/LegalPage.ts` が持つ
 */
export class SettingsPage {
	readonly page: Page;
	/** 画面タイトル（ja-JP: Settings.title） */
	readonly title: Locator;
	/** ご意見・不具合（フィードバック）行 */
	readonly feedbackItem: Locator;
	/** コミュニティガイドライン行 */
	readonly guidelinesItem: Locator;
	/** 利用規約行 */
	readonly termsItem: Locator;
	/** プライバシーポリシー行 */
	readonly privacyItem: Locator;
	/** 著作権行 */
	readonly copyrightItem: Locator;
	/** ブロック済みの料理トピック行 */
	readonly blockedTopicsItem: Locator;
	/** ログアウト行（ログイン済みユーザーのみ表示） */
	readonly logoutItem: Locator;
	/**
	 * #1510 通知カテゴリ別トグルのカード（ログイン済みユーザーのみ表示）。
	 * ゲストにはプッシュの受け手が存在しないためカードごと出ない。
	 */
	readonly notificationsCard: Locator;
	/** #1510 読み込み失敗時の再試行行（トグルの代わりに出る） */
	readonly notificationsErrorRow: Locator;
	/** #1510 OS 通知拒否中の案内行。Web は push 自体が無いため常に非表示 */
	readonly notificationsOsDeniedNotice: Locator;
	/**
	 * ログアウト確認ダイアログ（DialogProvider の confirm）。
	 *
	 * DialogProvider は確認ボタンに testID を付けていないため、react-native-paper が
	 * Dialog に付与する `modal-surface` でスコープを切ってからラベルで特定する。
	 * こうしないと「設定画面のログアウト行」と「ダイアログのログアウトボタン」の
	 * どちらも `name: "ログアウト"` の button として解決されてしまう。
	 */
	readonly logoutConfirmDialog: Locator;
	/** 確認ダイアログのタイトル（ja-JP: Settings.logoutConfirmTitle） */
	readonly logoutConfirmTitle: Locator;
	/** 確認ダイアログの「ログアウト」ボタン */
	readonly logoutConfirmButton: Locator;
	/** 確認ダイアログの「キャンセル」ボタン */
	readonly logoutCancelButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.title = page.getByText("設定", { exact: true });
		this.feedbackItem = page.getByTestId("settings-feedback");
		this.guidelinesItem = page.getByTestId("settings-guidelines");
		this.termsItem = page.getByTestId("settings-terms");
		this.privacyItem = page.getByTestId("settings-privacy");
		this.copyrightItem = page.getByTestId("settings-copyright");
		this.blockedTopicsItem = page.getByTestId("settings-blocked-topics");
		this.logoutItem = page.getByTestId("settings-logout");
		this.notificationsCard = page.getByTestId("settings-notifications-card");
		this.notificationsErrorRow = page.getByTestId("settings-notifications-error");
		this.notificationsOsDeniedNotice = page.getByTestId("settings-notifications-os-denied");
		this.logoutConfirmDialog = page.getByTestId("modal-surface");
		this.logoutConfirmTitle = page.getByText("ログアウトしますか？", { exact: true });
		this.logoutConfirmButton = this.logoutConfirmDialog.getByRole("button", { name: "ログアウト" });
		this.logoutCancelButton = this.logoutConfirmDialog.getByRole("button", { name: "キャンセル" });
	}

	/**
	 * #1510 通知カテゴリの行（トグル）を返す。
	 *
	 * `SettingsToggleItem` は行全体をタップ対象にし、Switch には `-switch` を足した
	 * testID を付ける。**押すのは行**（Switch は `pointerEvents="none"` で親へ透過する）、
	 * **状態を読むのは Switch**（react-native-web は `role="switch"` + `aria-checked` を出す）。
	 */
	notificationToggle(category: "likes" | "saves" | "group_votes"): Locator {
		return this.page.getByTestId(`settings-notifications-${category}`);
	}

	/** #1510 カテゴリのトグルが今オンかを読む */
	async isNotificationToggleOn(category: "likes" | "saves" | "group_votes"): Promise<boolean> {
		const checked = await this.notificationToggle(category).getAttribute("aria-checked");
		return checked === "true";
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/settings`);
	}

	/** 設定画面が表示されていることを検証する */
	async expectLoaded(): Promise<void> {
		await expect(this.title).toBeVisible();
	}

	/**
	 * ログアウト行をタップし、確認ダイアログを「ログアウト」で確定する。
	 *
	 * ⚠️ セッションを破壊する操作。呼び出す spec の設計上の注意は
	 * tests/authenticated/logout.spec.ts の冒頭コメントを参照すること。
	 */
	async logout(): Promise<void> {
		await this.logoutItem.click();
		// ダイアログの描画完了を待ってから押す（Portal 経由でマウントされるため）
		await expect(this.logoutConfirmTitle).toBeVisible();
		await this.logoutConfirmButton.click();
	}
}
