import { DEFAULT_TIMEOUT, by, element, existsNow, tapWhenVisible, waitFor, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🌐 表示言語の選択画面の Screen Object（#1508 / e2e-web の pages/LanguagePage.ts に対応）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/language.tsx
 *
 * 選択肢の testID は `language-option-<key>`（`key` は `"system"` または公開ロケール）。
 * RTL 未対応のため `ar-SA` は **選択肢に出ない**のが仕様で、その「無いこと」の検証には
 * `hasOption()` を使う（`existsNow` なので待たずに判定する）。
 */
export class LanguageScreen {
	/**
	 * ヘッダーのタイトル（`Settings.language.pageTitle`）。
	 * ScreenHeader へ `testID="language-header"` を渡しているので `-title` が付く。
	 */
	readonly headerTitle = by.id("language-header-title");
	/** ヘッダーの戻るボタン（#1404 の規約で `${testID}-back`） */
	readonly backButton = by.id("language-header-back");
	/** 「端末の設定に従う」行 */
	readonly systemOption = by.id("language-option-system");

	/** 選択肢の行を引く。`key` は `"system"` または公開ロケール（例: `"en-US"`） */
	option(key: string): Detox.NativeMatcher {
		return by.id(`language-option-${key}`);
	}

	/** 画面が表示されるまで待つ（ヘッダーの描画完了 = 遷移完了） */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
	}

	/**
	 * ヘッダーのタイトルが指定の文言になるまで **待って**検証する。
	 *
	 * ⚠️ `expect(...).toHaveText()` ではなく `waitFor(...).toHaveText()` を使うこと。
	 * 言語を選ぶと `router.replace()` で同じ画面のロケール違いへ遷移するため、
	 * タップ直後の一瞬は **切り替え前の文言のまま**描画されている。
	 * 待たない検証だと「切り替わっていないのに緑」か「まだ切り替わっていなくて赤」の
	 * どちらかにしかならず、どちらも本当のことを教えてくれない。
	 *
	 * @param text 期待する文言（ロケール依存。呼び出し側が locales の値をそのまま渡す）
	 */
	async expectHeaderTitle(text: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitFor(element(this.headerTitle)).toHaveText(text).withTimeout(timeout);
	}

	/**
	 * 「端末の設定に従う」行の文言を検証する（`Settings.language.systemDefault`）。
	 *
	 * ヘッダーだけだと «画面タイトルの i18n だけ効いている» 状態を見分けられないため、
	 * 本文側の文言も 1 つ見ておく。選択肢のラベル（「日本語」「English」…）はネイティブ名
	 * 固定で **どの言語でも変わらない**ので、切り替わりの観測点には使えない。
	 */
	async expectSystemOptionLabel(text: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitFor(element(this.systemOption)).toHaveText(text).withTimeout(timeout);
	}

	/**
	 * 指定した選択肢が **画面に在る**かを待たずに判定する。
	 * RTL（`ar-SA`）を除外できているかの検証に使う。
	 */
	async hasOption(key: string): Promise<boolean> {
		return existsNow(this.option(key));
	}

	/**
	 * 指定した文言の要素が **画面に無い**ことを判定する（待たずに即判定）。
	 * Detox の `by.text()` は完全一致なので、除外した言語のネイティブ名をそのまま渡す。
	 */
	async hasText(text: string): Promise<boolean> {
		return existsNow(by.text(text));
	}

	/** 言語を選ぶ（タップのみ。切り替わったことの検証は呼び出し側が行う） */
	async select(key: string): Promise<void> {
		await tapWhenVisible(this.option(key));
	}

	/** ヘッダーの戻るボタンで設定画面へ戻る */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
