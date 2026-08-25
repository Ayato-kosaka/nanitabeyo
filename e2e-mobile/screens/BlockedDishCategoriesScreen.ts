import { DEFAULT_TIMEOUT, by, element, expect as detoxExpect, existsNow, waitUntilVisible } from "../fixtures/e2e";

/**
 * 🚫 ブロック済み料理カテゴリ画面の Screen Object（e2e-web には対応 Page が無く、spec 内で直接 locator を組んでいる）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/blocked-dish-categories.tsx
 *
 * ## ファイル名・testID が "dishCategories" のままな理由（#1132）
 * #1132 で変わったのは **ユーザーに見える文言だけ**（「料理トピック」→「料理カテゴリ」）で、
 * ルート（`profile/blocked-dish-categories`）や既存 testID（`settings-blocked-dish-categories` /
 * `blocked-dish-categories-empty-state`）は据え置かれている。ここもアプリ側の識別子に合わせる。
 *
 * ## 文言の検証を Detox でどう行うか
 * Playwright の `getByText("トピック")` は **部分一致**だが、Detox の `by.text()` は
 * **完全一致**しか無く「〇〇を含む要素が 0 件」は表現できない。
 * そのため旧文言の残存チェックは「旧文言の完全一致文字列が存在しないこと」で行う
 * （locales の旧値を定数化してあるので、直し漏れがあればそのまま一致して落ちる）。
 */
export class BlockedDishCategoriesScreen {
	/**
	 * ヘッダーのタイトル（`Settings.blockedDishCategories.pageTitle`）。
	 * #1132 で app-expo 側の `ScreenHeader` へ `testID="blocked-dish-categories-header"` を渡すようにしたため、
	 * タイトル Text は `blocked-dish-categories-header-title` で取れる（ScreenHeader が `${testID}-title` を付与する）。
	 */
	readonly headerTitle = by.id("blocked-dish-categories-header-title");
	/** 0 件時の空表示（既存 testID。ブロック 0 件のテストユーザーではこちらが出る） */
	readonly emptyState = by.id("blocked-dish-categories-empty-state");

	/** 画面が表示されるまで待つ（ヘッダーの描画完了 = 遷移完了） */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
	}

	/**
	 * ヘッダーのタイトル文言を検証する。
	 * @param text 期待する文言（ロケール依存。呼び出し側が locales の値をそのまま渡す）
	 */
	async expectHeaderTitle(text: string): Promise<void> {
		await detoxExpect(element(this.headerTitle)).toHaveText(text);
	}

	/**
	 * 指定した文言の要素が **画面に無い**ことを判定する（待たずに即判定）。
	 *
	 * 旧文言の残存チェック専用。`existsNow` は「一致 0 件」も「複数一致」も false 以外にせず
	 * 素直に真偽を返すため、SettingsScreen.hasLogoutItem() と同じ使い方ができる。
	 */
	async hasText(text: string): Promise<boolean> {
		return existsNow(by.text(text));
	}
}
