import { expect, type Locator, type Page } from "@playwright/test";

/**
 * ⚙️ 設定項目の Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/index.tsx（マイページ本体）
 *
 * #1402 で **独立した設定画面（profile/settings.tsx）は無くなり**、その項目は
 * マイページの縦リストへ統合された。«設定という画面» は消えたが «設定という項目群» は
 * そのまま残っているので、この Page Object と `settings-*` の testID は据え置いてある。
 * マイページ側の要素（ログイン/編集ボタン・いいね/保存の行）は `pages/ProfilePage.ts` が持つ。
 *
 * - 「レビューを書く」（ストア誘導）は Web では非表示（Platform.OS !== "web" 条件）
 * - 「ログアウト」はログイン済み（非匿名）ユーザーのみ表示
 * - #1368 リーガル 4 行はモーダルではなく `/[locale]/legal/<doc>` へ遷移する。
 *   遷移先の検証は `pages/LegalPage.ts` が持つ
 */
export class SettingsPage {
	readonly page: Page;
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
	/** #1504 ハプティクスのオン/オフ行（タップ領域全体） */
	readonly hapticsToggleItem: Locator;
	/**
	 * ハプティクストグルの実 DOM 上の `<input type="checkbox" role="switch">`。
	 *
	 * `SettingsToggleItem` の `testID` は react-native-web の `Switch` では中身の `<input>` ではなく
	 * それを包む `<View>` へ `data-testid` として付与される（react-native-web の Switch 実装が
	 * `testID` を除外リストに含めず outer View へスプレッドしているため）。
	 * オン/オフの状態は `<input>` の `checked` にしか出ないので、そこまで一段掘って取得する。
	 */
	readonly hapticsToggleSwitch: Locator;
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

	constructor(page: Page) {
		this.page = page;
		this.feedbackItem = page.getByTestId("settings-feedback");
		this.guidelinesItem = page.getByTestId("settings-guidelines");
		this.termsItem = page.getByTestId("settings-terms");
		this.privacyItem = page.getByTestId("settings-privacy");
		this.copyrightItem = page.getByTestId("settings-copyright");
		this.blockedTopicsItem = page.getByTestId("settings-blocked-topics");
		this.hapticsToggleItem = page.getByTestId("settings-haptics-toggle");
		this.hapticsToggleSwitch = page.getByTestId("settings-haptics-toggle-switch").locator("input");
		this.logoutItem = page.getByTestId("settings-logout");
		this.logoutConfirmDialog = page.getByTestId("modal-surface");
		this.logoutConfirmTitle = page.getByText("ログアウトしますか？", { exact: true });
		this.logoutConfirmButton = this.logoutConfirmDialog.getByRole("button", { name: "ログアウト" });
		this.logoutCancelButton = this.logoutConfirmDialog.getByRole("button", { name: "キャンセル" });
	}

	/**
	 * 設定項目のある画面（＝マイページ）へ直接遷移する（locale プレフィックス必須）。
	 * #1402 以前は `/[locale]/profile/settings` だった。
	 */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile`);
	}

	/**
	 * 設定項目が表示されていることを検証する。
	 *
	 * #1402 以前は ScreenHeader のタイトル「設定」を見ていたが、その画面ごと無くなった。
	 * 代わりに «必ず出る行» の testID を見る（ロケール依存が 1 つ減るという副次的な利点もある）。
	 */
	async expectLoaded(): Promise<void> {
		await expect(this.feedbackItem).toBeVisible();
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
