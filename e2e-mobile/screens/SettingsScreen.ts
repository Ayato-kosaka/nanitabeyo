import {
	DEFAULT_TIMEOUT,
	by,
	element,
	existsNow,
	tapWhenVisible,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * ⚙️ 設定画面の Screen Object（e2e-web の pages/SettingsPage.ts に対応）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/settings.tsx
 *
 * - 「レビューを書く」（ストア誘導・settings-leave-review）は Web では非表示（`Platform.OS !== "web"` 条件）だが、
 *   ネイティブでは表示される（#1031 §1-1 の反転分類）。
 *   #1031 【設計確定】M2: 共有 dev 環境・外部ストアへの書き込みを避けるため、このボタンは
 *   **表示のみ検証しタップしない**（タップすると実際に Linking.openURL が走り外部アプリへ遷移してしまう）。
 * - 「ログアウト」はログイン済み（非匿名）ユーザーのみ表示。このワークスペースは匿名固定のテストのみを扱う（別 PR がログイン済みを担当）ため非表示側のみ検証する。
 */
export class SettingsScreen {
	/**
	 * 画面タイトル（ja-JP: Settings.title＝「設定」）。
	 * ナビゲーションヘッダー（ScreenHeader）のため testID 化は見送られている（#1031 確定 §3-P3）。
	 * i18n 文字列セレクタのため、翻訳キー変更時はここも見直すこと。
	 *
	 * ⚠️ 本 Screen Object で唯一のロケール依存セレクタ。**Android 端末のロケールが ja-JP でない場合、
	 * expectLoaded() がここで最初に落ちる**（iOS は launchApp の languageAndLocale で固定できるが、
	 * Android は CI 側で `adb shell setprop persist.sys.locale ja-JP` を実行する前提。#1031 B4）。
	 */
	readonly title = by.text("設定");
	/** ご意見・不具合（フィードバック）行（既存 testID） */
	readonly feedbackItem = by.id("settings-feedback");
	/** レビューを書く（ストア誘導）行。ネイティブのみ表示（既存 testID） */
	readonly leaveReviewItem = by.id("settings-leave-review");
	/** ブロック済みの料理トピック行（既存 testID） */
	readonly blockedTopicsItem = by.id("settings-blocked-topics");
	/** コミュニティガイドライン行（既存 testID） */
	readonly guidelinesItem = by.id("settings-guidelines");
	/** 利用規約行（既存 testID） */
	readonly termsItem = by.id("settings-terms");
	/** プライバシーポリシー行（既存 testID） */
	readonly privacyItem = by.id("settings-privacy");
	/** 著作権行（既存 testID） */
	readonly copyrightItem = by.id("settings-copyright");
	/** ログアウト行（ログイン済みユーザーのみ表示・既存 testID） */
	readonly logoutItem = by.id("settings-logout");
	/**
	 * リーガルドキュメントのモーダル（#1027 で settings.tsx へ testID を追加）。
	 *
	 * ログインモーダル内の同意文言リンク（`login-privacy-link`）でも同じモーダルが開くが、
	 * あちらは `<Text>` の入れ子でネイティブ View を持たず Detox から到達できない。
	 * ネイティブでのリーガルモーダル検証はこの経路に集約している（screens/LoginModal.ts 参照）。
	 */
	readonly legalDocumentModal = by.id("legal-document-modal");

	/** 設定画面が表示されていることを検証する */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.title, timeout);
	}

	/**
	 * ログアウト行が表示されているかを **待たずに** 判定する。
	 * 匿名/ログイン済みで可視性が変わるため、TabBar.hasNotificationsTab() と同じ考え方で使う。
	 */
	async hasLogoutItem(): Promise<boolean> {
		return existsNow(this.logoutItem);
	}

	/** プライバシーポリシー行をタップしてリーガルドキュメントのモーダルを開く */
	async openPrivacyPolicy(): Promise<void> {
		await tapWhenVisible(this.privacyItem);
	}

	/** リーガルドキュメントのモーダルが開いていることを検証する */
	async expectLegalDocumentOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.legalDocumentModal, timeout);
	}
}
