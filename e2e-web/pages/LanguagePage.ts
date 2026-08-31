import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🌐 表示言語の選択画面の Page Object（#1508）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/language.tsx
 *
 * - 選択肢は「端末の設定に従う」（`system`）＋ RTL を除く公開ロケール。
 *   RTL（`ar-SA`）が **出ないこと**が仕様なので、`option()` は
 *   「存在しない testID も引ける」形にしてある（`toHaveCount(0)` で検証するため）。
 * - 言語を選ぶと `router.replace()` で **同じパスのロケールだけ差し替えた URL** へ遷移する
 *   （`app-expo/lib/localeSwitch.ts`）。つまり言語画面に留まったまま文言だけが変わる。
 *   この「URL とラベルの両方が追随すること」が #1508 の観測点になる。
 */
export class LanguagePage {
	readonly page: Page;
	/** ヘッダーのタイトル（ScreenHeader が `${testID}-title` を付与する） */
	readonly headerTitle: Locator;
	/** ヘッダーの戻るボタン（#1404 の規約で `${testID}-back`） */
	readonly backButton: Locator;
	/**
	 * 切り替え中のオーバーレイ。
	 * フォント取得が速いと一瞬で消えるため、**表示を待つセレクタとしては使わない**
	 *（消えるのを待つ／存在しうることを示す用途に留める）。
	 */
	readonly switchingOverlay: Locator;
	/** 選択肢の行すべて（`language-option-` 前方一致） */
	readonly options: Locator;

	constructor(page: Page) {
		this.page = page;
		this.headerTitle = page.getByTestId("language-header-title");
		this.backButton = page.getByTestId("language-header-back");
		this.switchingOverlay = page.getByTestId("language-switching-overlay");
		this.options = page.locator('[data-testid^="language-option-"]');
	}

	/**
	 * 選択肢の行を引く。
	 * @param key `"system"` または公開ロケール（例: `"en-US"`）
	 */
	option(key: string): Locator {
		return this.page.getByTestId(`language-option-${key}`);
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/language`);
	}

	/**
	 * 言語画面が表示されていることを検証する。
	 * @param title 期待するヘッダー文言（locales の `Settings.language.pageTitle`）
	 */
	async expectLoaded(title: string): Promise<void> {
		await expect(this.headerTitle).toHaveText(title);
	}

	/**
	 * 言語を選び、URL のロケールが差し替わるまで待つ。
	 *
	 * ⚠️ クリック直後は「切り替えています…」のオーバーレイが載り、フォント取得（#1508 の
	 * `useLocaleFonts`）が終わるまで残ることがある。**URL の変化で待つ**のが唯一の確実な観測点で、
	 * 文言の検証はその後に行う（先に文言を待つと、切り替え前の文言に一致してしまい素通りする）。
	 *
	 * ⚠️ #1629【28】**着地は言語画面ではなく «タブの根»（`/<locale>/profile`）である。**
	 * 新しいロケールのパスへそのまま `replace` すると Stack がその 1 画面だけで組まれ、
	 * «プロフィールへ二度と戻れない» という実機の不具合になった
	 *（app-expo/app/[locale]/(tabs)/profile/language.tsx の注記）。
	 * 続けて切り替えたいときは `reopen()` で言語画面を開き直すこと。
	 *
	 * @param key 押す選択肢（`"system"` または公開ロケール）
	 * @param expectedLocale 遷移後に URL へ現れるロケール（`"system"` なら端末ロケールの解決結果）
	 */
	async select(key: string, expectedLocale: string): Promise<void> {
		await this.option(key).click();
		await this.page.waitForURL(new RegExp(`/${expectedLocale}/profile(/|$)`));
	}

	/**
	 * #1629【28】言語を選び、切り替わったあとの言語画面を開き直す。
	 *
	 * 切り替えの着地はタブの根なので、«続けてもう一度切り替える» には開き直しが要る。
	 * 実ユーザーも同じ手順（マイページ → 端末設定 → 言語）を踏む。
	 */
	async selectAndReopen(key: string, expectedLocale: string): Promise<void> {
		await this.select(key, expectedLocale);
		await this.goto(expectedLocale);
	}
}
