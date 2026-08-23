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
	/** #1511 アカウント削除行（ログイン済みユーザーのみ表示） */
	readonly deleteAccountItem: Locator;
	/** #1511 1 枚目（影響の説明）ダイアログのタイトル（ja-JP: Settings.deleteAccountConfirmTitle） */
	readonly deleteAccountConfirmTitle: Locator;
	/** #1511 1 枚目の本文。**「取り消せない」と明記されていること**を見るための素材 */
	readonly deleteAccountConfirmMessage: Locator;
	/** #1511 2 枚目（取り消せないことへの同意）ダイアログのタイトル */
	readonly deleteAccountFinalTitle: Locator;
	/**
	 * #1511 確認ダイアログの OK / キャンセル。
	 *
	 * `confirm()`（DialogProvider）が出すダイアログは既定 testID を持つ（#1131）。
	 * ログアウト側がラベル一致で掴んでいるのは、当時 testID が無かった名残であり、
	 * 新しく足すこちらは **多言語で壊れない testID** を使う。
	 */
	readonly dialogConfirmButton: Locator;
	readonly dialogCancelButton: Locator;

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
		this.logoutConfirmDialog = page.getByTestId("modal-surface");
		this.logoutConfirmTitle = page.getByText("ログアウトしますか？", { exact: true });
		this.logoutConfirmButton = this.logoutConfirmDialog.getByRole("button", { name: "ログアウト" });
		this.logoutCancelButton = this.logoutConfirmDialog.getByRole("button", { name: "キャンセル" });
		this.deleteAccountItem = page.getByTestId("settings-delete-account");
		this.deleteAccountConfirmTitle = page.getByText("アカウントを削除しますか？", { exact: true });
		this.deleteAccountConfirmMessage = page.getByText("この操作は取り消せません。");
		this.deleteAccountFinalTitle = page.getByText("本当に削除しますか？", { exact: true });
		this.dialogConfirmButton = page.getByTestId("dialog-confirm-button");
		this.dialogCancelButton = page.getByTestId("dialog-cancel-button");
	}

	/**
	 * #1511 アカウント削除行を押して 1 枚目の確認ダイアログを開く（**確定しない**）。
	 *
	 * 削除は取り消せないので、確定まで行う操作は Page Object に置かない。
	 * 「開くところまで」と「確定」を分けておくと、キャンセル経路のテストが
	 * 誤って本物の削除を走らせる事故を構造的に防げる。
	 */
	async openDeleteAccountDialog(): Promise<void> {
		await this.deleteAccountItem.click();
		await expect(this.deleteAccountConfirmTitle).toBeVisible();
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
