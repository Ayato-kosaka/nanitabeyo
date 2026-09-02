/**
 * 🌐 公開ロケール（URL prefix と完全一致する形式）の唯一の定義。
 *
 * ## なぜ shared に置くのか（#721）
 * この一覧は元々 `app-expo/constants/seoLocales.ts` にだけありました。
 * 共有リンク（`share_links.preview_locale`）は **API 側で validation する**必要があるため、
 * api からも参照できる場所へ移しています。
 *
 * ⚠️ **api と app-expo で別々に持たないこと。** #281 では sitemap の生成器が 2 本になり、
 * 「片方だけ新しくなって本番は古いまま」という状態を生みました。ロケール一覧も同じ形の事故を起こします
 * （sitemap の URL 数、hreflang、共有リンクの locale validation が静かにずれる）。
 *
 * `app-expo/constants/seoLocales.ts` はここから再 export しているだけなので、
 * app 側の import パスは変えずに済みます。
 */

/**
 * 公開されているロケール一覧（URL prefix として使用される形式）。
 *
 * `I18N_SUPPORTED_LOCALES` には alias（en, en-NZ, ja, fr 等）が含まれますが、
 * SEO 用途（hreflang / canonical / og:locale）と共有リンクでは
 * URL prefix と完全一致するものだけを使います。
 */
export const PUBLIC_LOCALES = ["ja-JP", "en-US", "fr-FR", "zh-CN", "ar-SA", "ko-KR", "es-ES", "hi-IN"] as const;

/**
 * デフォルトの公開ロケール。
 * x-default hreflang や、ロケール不明時のフォールバックに使用する。
 */
export const DEFAULT_PUBLIC_LOCALE = "ja-JP";

export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

/** 文字列が公開ロケールかどうか（型を絞り込む） */
export function isPublicLocale(value: unknown): value is PublicLocale {
	return typeof value === "string" && (PUBLIC_LOCALES as readonly string[]).includes(value);
}

/**
 * 任意のロケール文字列を、必ず公開ロケールのどれかへ解決する。
 *
 * 1. 完全一致（`ja-JP`）
 * 2. 言語部分の前方一致（`ja` → `ja-JP`、`en-GB` → `en-US`）
 * 3. どれにも当たらなければ既定（`ja-JP`）
 *
 * @param locale 解決したいロケール（未指定可）
 * @returns 公開ロケールのいずれか
 */
export function resolvePublicLocale(locale?: string): PublicLocale {
	if (!locale) return DEFAULT_PUBLIC_LOCALE;
	const normalized = locale.trim();
	if (isPublicLocale(normalized)) return normalized;
	const lang = normalized.split("-")[0];
	const matched = PUBLIC_LOCALES.find((l) => l.startsWith(lang));
	return matched ?? DEFAULT_PUBLIC_LOCALE;
}

/**
 * `ja-JP` → `ja_JP`。OGP の `og:locale` は BCP 47 のハイフンではなく
 * アンダースコア区切りを要求する（Facebook / LINE / X いずれも）。
 *
 * ⚠️ 変換をその場で書かないこと。web の `SeoHeadRenderer` と共有リンクの SSR で
 * 別々に書くと、片方だけ直したときに OGP が壊れる。
 */
export function toOgLocale(locale: PublicLocale): string {
	return locale.replace("-", "_");
}
