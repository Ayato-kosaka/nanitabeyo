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
	/**
	 * #1504 端末設定行（規約カードの直上）。
	 * トグル本体はこの行から push される端末設定画面にあり、`pages/DeviceSettingsPage.ts` が持つ。
	 */
	readonly deviceSettingsItem: Locator;
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
	/**
	 * #1509 表示テーマの 3 択セレクタ（システム追従 / ライト / ダーク）のコンテナ。
	 * `themeCardSurface` はこの直上の要素で、Card の面色（`Palette.surface`）を持つ。
	 */
	readonly themeSelector: Locator;
	/**
	 * テーマセレクタを載せている Card の面。
	 *
	 * react-native-web は `Card` の `backgroundColor` をこの div の computed style に出すため、
	 * 「面がテーマで切り替わったか」を色で検証できる唯一の安定した観測点になる。
	 * セレクタ自身（`themeSelector`）は背景を持たないので、こちらを見ること。
	 */
	readonly themeCardSurface: Locator;

	constructor(page: Page) {
		this.page = page;
		this.feedbackItem = page.getByTestId("settings-feedback");
		this.guidelinesItem = page.getByTestId("settings-guidelines");
		this.termsItem = page.getByTestId("settings-terms");
		this.privacyItem = page.getByTestId("settings-privacy");
		this.copyrightItem = page.getByTestId("settings-copyright");
		this.blockedTopicsItem = page.getByTestId("settings-blocked-topics");
		this.deviceSettingsItem = page.getByTestId("settings-device-settings");
		this.logoutItem = page.getByTestId("settings-logout");
		this.logoutConfirmDialog = page.getByTestId("modal-surface");
		this.logoutConfirmTitle = page.getByText("ログアウトしますか？", { exact: true });
		this.logoutConfirmButton = this.logoutConfirmDialog.getByRole("button", { name: "ログアウト" });
		this.logoutCancelButton = this.logoutConfirmDialog.getByRole("button", { name: "キャンセル" });
		this.themeSelector = page.getByTestId("settings-theme-selector");
		this.themeCardSurface = this.themeSelector.locator("xpath=..");
	}

	/** テーマ 3 択の 1 行（#1509） */
	themeOption(preference: "system" | "light" | "dark"): Locator {
		return this.page.getByTestId(`settings-theme-${preference}`);
	}

	/**
	 * 選択中を示すチェックアイコン（選択されている行にだけ存在する）。
	 *
	 * `aria-checked` ではなくアイコンの有無で見るのは、react-native-web が
	 * `accessibilityState.checked` を DOM の `aria-checked` へ変換しないため
	 *（`features/search/components/SelectableChip.tsx` のコメントと同じ既知の非対応）。
	 */
	themeOptionCheck(preference: "system" | "light" | "dark"): Locator {
		return this.page.getByTestId(`settings-theme-${preference}-check`);
	}

	/** テーマを選び、選択状態が切り替わるまで待つ（#1509） */
	async selectTheme(preference: "system" | "light" | "dark"): Promise<void> {
		await this.themeOption(preference).click();
		await expect(this.themeOptionCheck(preference)).toBeVisible();
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

	/** #1504 端末設定行をタップして端末設定画面（`/[locale]/profile/device-settings`）へ遷移する */
	async openDeviceSettings(): Promise<void> {
		await this.deviceSettingsItem.click();
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
