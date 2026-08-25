import { test, expect } from "../../fixtures/test";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * 🈁 ブロック済み料理カテゴリの文言（#1132）
 *
 * #1132 は「ブロック済み料理トピック」という文言が不自然だったため、
 * 8 言語分を「料理カテゴリ」へ統一した変更（PR #1148）。
 *
 * ## なぜ E2E で守るのか
 * 文言の統一は locales/*.json の 8 ファイルへ散らばるので、
 * 1 ファイルだけ直し漏れても型検査もユニットテストも通ってしまう。
 * 「画面に旧文言が出ていないこと」は実際に描画しないと分からないため E2E で見る。
 *
 * ## 言語を 2 つに絞っている理由
 * 8 言語すべてを起動すると遅い。ja-JP（変更の主対象）と ar-SA（RTL で
 * レイアウトが崩れやすい）だけを回し、残りは locales の値を直接読む
 * ユニットテスト側で担保する方針。
 */
test.describe("ブロック済み料理カテゴリの文言(#1132)", () => {
	// ─ テストケース: ja-JP で新文言が出て、旧文言が残っていない ─
	// 手順:
	//   1. /ja-JP/profile/blocked-dish-categories へ直接遷移する
	//   2. ScreenHeader の pageTitle が「ブロック済みの料理カテゴリ」であることを検証
	//   3. 画面のどこにも「トピック」が残っていないことを検証（これが #1132 の本体）
	test("ja-JP で「料理カテゴリ」と表示され、旧文言「トピック」が残っていない", async ({ appPage }) => {
		await appPage.goto("/ja-JP/profile/blocked-dish-categories");

		// locales/ja-JP.json の Settings.blockedDishCategories.pageTitle と同じ文字列
		await expect(appPage.getByText("ブロック済みの料理カテゴリ", { exact: true })).toBeVisible();

		// ⚠️ ここが本題。1 ファイルでも直し漏れると旧文言が画面へ出る。
		//    exact: false で「トピック」を含む要素が 1 つも無いことを見る。
		await expect(appPage.getByText("トピック")).toHaveCount(0);
	});

	// ─ テストケース: 設定メニューの導線も新文言になっている ─
	//
	// ⚠️ #1402 でこの検査の守備範囲が広がった。設定はマイページの縦リストへ統合されたので、
	// 「画面のどこにも『トピック』が無い」は **マイページ全体**に掛かる。#1402 が足した
	// 「保存した料理カテゴリ」の行も、ここで «カテゴリ» に揃っていることが担保される
	// （設計コメントの表記は「保存した料理トピック」だが、#1132 の統一に従って「カテゴリ」を採った）。
	//
	// 手順:
	//   1. /ja-JP/profile を開く（#1402 以前は /ja-JP/profile/settings）
	//   2. ブロック済み項目（settings-blocked-dish-categories）が表示されることを検証
	//   3. マイページにも旧文言「トピック」が残っていないことを検証
	//      （導線側のキーだけ直し漏れる事故を防ぐ）
	test("設定メニューの導線にも旧文言が残っていない", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.blockedDishCategoriesItem).toBeVisible();
		await expect(appPage.getByText("トピック")).toHaveCount(0);
	});

	// ─ テストケース: ar-SA(RTL) でも表示が崩れていない ─
	// 手順:
	//   1. /ar-SA/profile/blocked-dish-categories へ直接遷移する
	//   2. アラビア語の pageTitle が表示されることを検証
	//      （RTL で要素が画面外へ出ると toBeVisible が落ちる）
	//   3. 日本語が混入していないことを検証（フォールバックで ja-JP へ落ちる事故の検知）
	test("ar-SA(RTL) でも翻訳が表示され、日本語へフォールバックしていない", async ({ appPage }) => {
		await appPage.goto("/ar-SA/profile/blocked-dish-categories");

		// locales/ar-SA.json の Settings.blockedDishCategories.pageTitle
		await expect(appPage.getByText("فئات الأطباق المحظورة", { exact: true })).toBeVisible();

		// ロケール解決が壊れると ja-JP の文言が出る（#721 の症状 b と同じ型の事故）
		await expect(appPage.getByText("ブロック済みの料理カテゴリ")).toHaveCount(0);
	});
});
