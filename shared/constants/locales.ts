/**
 * サポートされているロケール一覧
 * #i18n 【設計】アプリでサポートする全言語を定義
 */
export const SUPPORTED_LOCALES = [
	'ar-SA',
	'en-US',
	'es-ES',
	'fr-FR',
	'hi-IN',
	'ja-JP',
	'ko-KR',
	'zh-CN',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
