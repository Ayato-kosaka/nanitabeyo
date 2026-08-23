import { DEFAULT_TIMEOUT, by, element, existsNow, tapWhenVisible, waitFor, waitUntilVisible } from "../fixtures/e2e";

/**
 * 設定画面から開ける法務ドキュメント（#1368）。
 * 値は `app-expo/lib/legalRoute.ts` の `LEGAL_DOCUMENT_TYPES` と対応する（URL の `doc` セグメント）。
 */
export type LegalDocumentKey = "guidelines" | "terms" | "privacy" | "copyright";

/**
 * ⚙️ 設定画面の Screen Object（e2e-web の pages/SettingsPage.ts に対応）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/settings.tsx
 *
 * - 「レビューを書く」（ストア誘導・settings-leave-review）は Web では非表示（`Platform.OS !== "web"` 条件）だが、
 *   ネイティブでは表示される（#1031 §1-1 の反転分類）。
 *   #1031 【設計確定】M2: 共有 dev 環境・外部ストアへの書き込みを避けるため、このボタンは
 *   **表示のみ検証しタップしない**（タップすると実際に Linking.openURL が走り外部アプリへ遷移してしまう）。
 * - 「ログアウト」はログイン済み（非匿名）ユーザーのみ表示。
 *   匿名側（非表示）は tests/profile/settings.test.ts、実行そのものは tests/authenticated/logout.test.ts が検証する。
 * - #1368 リーガル 4 行はモーダル起動ではなく `/[locale]/legal/<doc>` への画面遷移になった。
 *   遷移先の検証は screens/LegalScreen.ts が持つ。
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
	/**
	 * ブロック済みの料理カテゴリ行（既存 testID）。
	 * #1132 で文言は「料理トピック」→「料理カテゴリ」へ変わったが、testID は据え置かれている。
	 */
	readonly blockedTopicsItem = by.id("settings-blocked-topics");
	/** 表示言語行（#1508。Card 1 の最終行として追加された） */
	readonly languageItem = by.id("settings-language");
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
	 * ログアウト確認ダイアログのタイトル（ja-JP: `Settings.logoutConfirmTitle`）。
	 * DialogProvider（react-native-paper の Dialog）はタイトルに testID を持たないため文字列で特定する。
	 * `title` と同じくロケール依存のセレクタなので、翻訳キーを変えたらここも直すこと。
	 */
	readonly logoutConfirmTitle = by.text("ログアウトしますか？");
	/**
	 * 確認ダイアログの「ログアウト」ボタン（#1131 で DialogProvider に既定 testID を追加）。
	 *
	 * ⚠️ `by.text("ログアウト")` は使えない。ダイアログが開いている間は
	 * **設定画面のログアウト行とダイアログのボタンが同時に存在する**ため matcher が 2 件に一致し、
	 * Detox は複数一致した要素の操作を例外にする（utils/waits.ts の `target()` 参照）。
	 */
	readonly logoutConfirmButton = by.id("dialog-confirm-button");
	/** 確認ダイアログの「キャンセル」ボタン（#1131 で追加した既定 testID） */
	readonly logoutCancelButton = by.id("dialog-cancel-button");
	/**
	 * #1368 リーガル 4 行は **モーダルではなく画面遷移**（`/[locale]/legal/<doc>`）になった。
	 * 遷移先の検証は `screens/LegalScreen.ts` が持つ。
	 *
	 * ログイン画面（`/[locale]/auth/login`）の同意文言リンク（`login-privacy-link` /
	 * `login-terms-link`）からも同じ画面へ遷移できるが、あちらは `<Text>` の入れ子で
	 * ネイティブ View を持たず Detox から到達できない（理由は #1027 から変わっていない）。
	 * ネイティブでのリーガル導線の検証はこの実体のある行に集約している
	 *（screens/LoginScreen.ts 参照）。
	 */
	private readonly legalItemByDoc = {
		guidelines: this.guidelinesItem,
		terms: this.termsItem,
		privacy: this.privacyItem,
		copyright: this.copyrightItem,
	} as const;

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

	/**
	 * 指定した文言の要素が設定画面に **無い**ことを判定する（待たずに即判定）。
	 * #1132 の「旧文言が導線側に残っていないこと」の検証に使う。
	 */
	async hasText(text: string): Promise<boolean> {
		return existsNow(by.text(text));
	}

	/**
	 * ブロック済みの料理カテゴリ行をタップして一覧画面へ遷移する（#1132）。
	 * e2e-web は `/ja-JP/profile/blocked-topics` へ URL 直遷移するが、
	 * ネイティブには代替経路が無いため settings.test.ts と同じく実 UI 導線をタップする。
	 */
	async openBlockedTopics(): Promise<void> {
		await tapWhenVisible(this.blockedTopicsItem);
	}

	/**
	 * 表示言語の選択画面へ遷移する（#1508）。
	 *
	 * ⚠️ この行は Card 1 の最終行で、エミュレータの画面高では初期表示から少し外れることがある。
	 * `scrollToLogout()` と同じ理由（Detox の `toBeVisible()` は面積の 75% 以上の可視を要求する）で、
	 * 見えるところまでスクロールしてから押す。既に見えていれば 1 度も動かさずに返る。
	 */
	async openLanguage(): Promise<void> {
		await waitFor(element(this.languageItem)).toBeVisible().whileElement(by.id("settings-scroll")).scroll(300, "down");
		await tapWhenVisible(this.languageItem);
	}

	/** プライバシーポリシー行をタップして法務ドキュメント画面へ遷移する（#1368 でモーダル起動から変更） */
	async openPrivacyPolicy(): Promise<void> {
		await tapWhenVisible(this.privacyItem);
	}

	/**
	 * 指定した法務ドキュメントの行をタップして `/[locale]/legal/<doc>` へ遷移する（#1368）。
	 *
	 * 4 行はアプリ側で同じハンドラを通るため、`doc` の取り違え（規約を押したら著作権が開く）は
	 * **行ごとに**踏まないと見つからない。行の指定をここで引けるようにしておく。
	 */
	async openLegalDocument(doc: LegalDocumentKey): Promise<void> {
		await tapWhenVisible(this.legalItemByDoc[doc]);
	}

	/**
	 * ログアウト行が **見える位置まで** 設定画面をスクロールする（#1131）。
	 *
	 * ## なぜ要るのか（CI で実際に赤くなった）
	 * ログアウト行は設定画面の最下段のカードにあり、エミュレータの画面高では
	 * **初期表示で画面外**にいる。Detox の `toBeVisible()` は「面積の 75% 以上が可視」を
	 * 要求するので、`toExist()` は真でも `toBeVisible()` は永久に偽のまま 25 秒待って落ちる。
	 * `hasLogoutItem()` が `existsNow`（= `toExist`）なのは匿名側で「無い」ことを見るためで、
	 * **押せるかどうか**を見るこちらとは要求が違う。
	 *
	 * `whileElement(...).scroll()` は「見つかるまでスクロールする」Detox の標準手段で、
	 * 既に見えている場合は 1 度も動かさずに返る（画面が大きい端末でも安全）。
	 */
	async scrollToLogout(): Promise<void> {
		await waitFor(element(this.logoutItem)).toBeVisible().whileElement(by.id("settings-scroll")).scroll(300, "down");
	}

	/**
	 * ログアウト行をタップし、確認ダイアログを「ログアウト」で確定する（#1131）。
	 *
	 * ⚠️ **セッションを破壊する操作。** 共有セッション（globalSetup 発行）で呼んではいけない
	 * （サーバ側でも失効し、後続の authenticated テストが軒並み落ちる）。
	 * 呼び出す spec の設計上の注意は tests/authenticated/logout.test.ts の冒頭コメントを参照すること。
	 */
	async logout(): Promise<void> {
		await this.scrollToLogout();
		await tapWhenVisible(this.logoutItem);
		// Portal 経由でマウントされるため、ダイアログの描画完了（タイトル）を待ってから押す
		await waitUntilVisible(this.logoutConfirmTitle);
		await tapWhenVisible(this.logoutConfirmButton);
	}
}
