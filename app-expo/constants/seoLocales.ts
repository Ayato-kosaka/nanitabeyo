/**
 * SEO用の公開ロケール定義
 *
 * I18N_SUPPORTED_LOCALES には alias（en, ja, fr 等）が含まれるが、
 * SEO用途（hreflang/canonical/og:locale）では URL prefix と完全一致する
 * ロケールのみを使用する。
 *
 * URL 設計: https://app.nanitabeyo.net/{locale}/...
 * 例: /ja-JP/posts/123, /en-US/posts/123
 */

/**
 * 公開されているロケール一覧（URL prefix として使用される形式）
 */
export const PUBLIC_LOCALES = [
	"ja-JP",
	"en-US",
	"fr-FR",
	"zh-CN",
	"ar-SA",
	"ko-KR",
	"es-ES",
	"hi-IN",
] as const;

/**
 * デフォルトの公開ロケール
 * x-default hreflang や、ロケール不明時のフォールバックに使用
 */
export const DEFAULT_PUBLIC_LOCALE = "ja-JP";

export type PublicLocale = (typeof PUBLIC_LOCALES)[number];
