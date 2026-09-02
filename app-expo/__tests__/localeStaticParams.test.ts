// #721 【テスト】ロケールごとの静的プリレンダが失われないことを守る。
//
// generateStaticParams が消える／減ると、expo export は動的セグメントを
// リテラル `[locale]` の HTML 1 枚だけに畳んでしまう。その 1 枚をプリレンダするとき
// usePathname() は `/[locale]/...` を返すため useLocale が `"[locale]"` を拾い、
// フォールバックで ja-JP に落ちる。結果、全言語が同じ日本語ページを受け取る（#721 症状 b）。
//
// ビルド成果物そのものはユニットテストで検証できないため、
// 「全公開ロケールが列挙されること」という前提条件だけをここで固定する。

import { buildLocaleStaticParams } from "@/lib/seo/localeStaticParams";
import { PUBLIC_LOCALES, resolvePublicLocale, DEFAULT_PUBLIC_LOCALE } from "@/constants/seoLocales";

describe("#721 locale static params", () => {
	it("公開ロケールを全て返す", () => {
		const params = buildLocaleStaticParams();

		expect(params.map((p) => p.locale).sort()).toEqual([...PUBLIC_LOCALES].sort());
	});

	it("ロケールを1件も落とさない（8言語）", () => {
		// 数を明示しておくと、ロケール追加時にこのテストが気付かせてくれる
		expect(buildLocaleStaticParams()).toHaveLength(PUBLIC_LOCALES.length);
		expect(PUBLIC_LOCALES.length).toBe(8);
	});

	it("リテラル `[locale]` は公開ロケールとして解決されない（#721 の根因の再現）", () => {
		// プリレンダ時に usePathname() が `/[locale]/posts` を返していたときの挙動。
		// ja-JP へフォールバックするため、全言語が日本語ページになっていた。
		expect(resolvePublicLocale("[locale]")).toBe(DEFAULT_PUBLIC_LOCALE);
		expect(DEFAULT_PUBLIC_LOCALE).toBe("ja-JP");
	});

	it("正しいロケールはそのまま解決される", () => {
		expect(resolvePublicLocale("en-US")).toBe("en-US");
		expect(resolvePublicLocale("fr-FR")).toBe("fr-FR");
	});
});
