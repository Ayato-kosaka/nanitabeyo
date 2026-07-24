import { test, expect } from "../../fixtures/test";

/**
 * 🔎 SEO メタタグのテスト(Web 特有の価値・desktop のみ)
 *
 * 目的: SeoHeadRenderer.web.tsx が出力する SEO メタ情報
 *       (title / description / canonical / hreflang / OGP)の退行を検知する。
 * 期待値の定義元: app-expo/constants/seoLocales.ts(PUBLIC_LOCALES は 8 ロケール)
 */
test.describe("SEO メタタグ(ja-JP)", () => {
	// ─ テストケース: title・description・canonical が ja-JP 定義と一致する ─
	// 手順:
	//   1. /ja-JP へ遷移する
	//   2. <title> が seoLocales.ts の ja-JP タイトル
	//      「なに食べよ ~食べたい料理が見つかる新感覚グルメアプリ~」と一致することを検証
	//   3. meta[name=description] と link[rel=canonical] の存在・値を検証
	test("title / description / canonical が正しい", async ({ appPage }) => {
		await expect(appPage).toHaveTitle("なに食べよ ~食べたい料理が見つかる新感覚グルメアプリ~");
		await expect(appPage.locator('meta[name="description"]')).toHaveAttribute(
			"content",
			"あなたの気分を入力すると、AIが「これ食べたいでしょ！」という料理を提案してくれます。提案された料理写真やレビューを見ながら、直感的にお店を選べます。",
		);
		await expect(appPage.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/ja-JP\/?$/);
	});

	// ─ テストケース: hreflang alternate が全公開ロケール + x-default 分出力される ─
	// 手順:
	//   1. /ja-JP へ遷移する
	//   2. link[rel=alternate] が PUBLIC_LOCALES(8 ロケール)+ x-default の
	//      合計 9 件出力されることを検証
	//   3. hreflang="x-default" の alternate が存在することを検証
	test("hreflang alternate が 8 ロケール + x-default 出力される", async ({ appPage }) => {
		const alternates = appPage.locator('link[rel="alternate"]');
		await expect(alternates).toHaveCount(9);
		await expect(appPage.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
		await expect(appPage.locator('link[rel="alternate"][hreflang="ja-JP"]')).toHaveCount(1);
	});

	// ─ テストケース: OGP / Twitter カードが出力される ─
	// 手順:
	//   1. /ja-JP へ遷移する
	//   2. og:type / og:site_name / og:title / og:image:width(1200) / height(630) の meta を検証
	//   3. twitter:card = summary_large_image を検証
	test("OGP / Twitter カードが出力される", async ({ appPage }) => {
		await expect(appPage.locator('meta[property="og:type"]')).toHaveAttribute("content", "website");
		await expect(appPage.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "なに食べよ");
		await expect(appPage.locator('meta[property="og:title"]')).toHaveAttribute(
			"content",
			"なに食べよ ~食べたい料理が見つかる新感覚グルメアプリ~",
		);
		await expect(appPage.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
		await expect(appPage.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
		await expect(appPage.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
	});
});
