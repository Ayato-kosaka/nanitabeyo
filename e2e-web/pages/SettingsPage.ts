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
	readonly blockedDishCategoriesItem: Locator;
	/** 表示言語行（#1508。Card 2 の最終行） */
	readonly languageItem: Locator;
	/**
	 * #1504 端末設定行（規約カードの直上）。
	 * トグル本体はこの行から push される端末設定画面にあり、`pages/DeviceSettingsPage.ts` が持つ。
	 */
	readonly deviceSettingsItem: Locator;
	/** #1583 マイページ → «なに食べよについて» の行 */
	readonly aboutItem: Locator;
	/**
	 * #1583 «なに食べよについて» の戻るボタン。
	 *
	 * `ScreenHeader` は `${testID}-back` を出す（素の testID は出さない）。
	 * ページを分けた以上、**戻ってこられることまで見ないと行き止まりを作れる**ので
	 * ロケータを持たせてある（`DeviceSettingsPage.backButton` と同じ考え方）。
	 */
	readonly aboutBackButton: Locator;
	/**
	 * バージョン表示（#1495 SUP-03）。"{version}({短縮コミットID})" の 1 行、例: "1.14.0(abc1234)"。
	 * 対応コンポーネント: app-expo/components/VersionInfo.tsx
	 */
	readonly versionText: Locator;
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
		this.blockedDishCategoriesItem = page.getByTestId("settings-blocked-dish-categories");
		this.languageItem = page.getByTestId("settings-language");
		this.deviceSettingsItem = page.getByTestId("settings-device-settings");
		// #1583 マイページ → なに食べよについて の行
		this.aboutItem = page.getByTestId("settings-about");
		this.aboutBackButton = page.getByTestId("about-screen-back");
		this.versionText = page.getByTestId("settings-version-section");
		this.logoutItem = page.getByTestId("settings-logout");
		this.notificationsCard = page.getByTestId("settings-notifications-card");
		this.notificationsErrorRow = page.getByTestId("settings-notifications-error");
		this.notificationsOsDeniedNotice = page.getByTestId("settings-notifications-os-denied");
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
		this.themeSelector = page.getByTestId("settings-theme-selector");
		this.themeCardSurface = this.themeSelector.locator("xpath=..");
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

	/*
	#1583 設定項目は 3 画面に散っている。
	  マイページ …… いいね / 保存 / ご意見 / ブロック済み / 通報履歴 / 言語 / 投票 /
	                （端末設定へ）/（なに食べよについてへ）/ ログアウト
	  端末設定 ……… ハプティクス / 表示テーマ
	  なに食べよについて … 応援する / 規約 4 種 / バージョン
	テーマとリーガルの行は **マイページには無い**ので、下の 2 つで先に移動すること。
	*/

	/** #1504 端末設定行をタップして端末設定画面（`/[locale]/profile/device-settings`）へ遷移する */
	async openDeviceSettings(): Promise<void> {
		await this.deviceSettingsItem.click();
		// #1583 表示テーマがここへ移った
		await expect(this.themeSelector).toBeVisible();
	}

	/** #1583 «なに食べよについて» 行をタップして `/[locale]/profile/about` へ遷移する */
	async openAbout(): Promise<void> {
		await this.aboutItem.click();
		await expect(this.termsItem).toBeVisible();
	}

	/** #1583 端末設定ページへ直接遷移する（導線ではなく画面の中身を見たいとき） */
	async gotoDeviceSettings(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/device-settings`);
		await expect(this.themeSelector).toBeVisible();
	}

	/** #1583 «なに食べよについて» へ直接遷移する */
	async gotoAbout(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/about`);
		await expect(this.termsItem).toBeVisible();
	}

	/**
	 * #1510 通知カテゴリの行（トグル）を返す。**押すのはこの行。**
	 *
	 * `SettingsToggleItem` は行全体をタップ対象にし、Switch 側は `pointerEvents="none"` で
	 * タッチを親へ透過させる（ラベルを押しても切り替わるようにするため）。
	 */
	notificationToggle(category: "likes" | "saves" | "group_votes"): Locator {
		return this.page.getByTestId(`settings-notifications-${category}`);
	}

	/**
	 * #1510 カテゴリのトグルが今オンかを読む。
	 *
	 * ⚠️ **行の `aria-checked` は読めない。** 行には `accessibilityState={{ checked }}` を
	 * 渡しているが、react-native-web はこれを `aria-checked` として出力しない
	 * （実測: 行は `role="switch"` と `aria-label` だけを持ち、`aria-checked` は付かない）。
	 * 実際の状態は行の中に描かれる `<input type="checkbox" role="switch">` の `checked` にある。
	 * ここを行側から読もうとして 1 度書き直しているので、戻さないこと。
	 */
	async isNotificationToggleOn(category: "likes" | "saves" | "group_votes"): Promise<boolean> {
		return this.notificationToggle(category).locator('input[type="checkbox"]').isChecked();
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
