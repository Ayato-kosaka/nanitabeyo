/**
 * 多言語対応のための i18n 初期化モジュール。
 *
 * 未対応ロケールは自動的に英語（en-US）にフォールバック。
 *
 * `getResolvedLocale(locale?: string)` により、
 * 任意のロケール値から最適なサポートロケールを特定可能。
 *
 * ※ 実際の `locale` 設定は app/[locale]/_layout.tsx 側で行います。
 */

import { I18n } from "i18n-js";

// 各ロケール用翻訳ファイル
import en_US from "../locales/en-US.json";
import ja_JP from "../locales/ja-JP.json";
import fr_FR from "../locales/fr-FR.json";
import zh_CN from "../locales/zh-CN.json";
import ar_SA from "../locales/ar-SA.json";
import ko_KR from "../locales/ko-KR.json";
import es_ES from "../locales/es-ES.json";
import hi_IN from "../locales/hi-IN.json";

// let _: typeof en_US = en_US; // 型チェック用
// _ = ja_JP; // 型チェック用
// _ = fr_FR; // 型チェック用
// _ = zh_CN; // 型チェック用
// _ = ar_SA; // 型チェック用
// _ = ko_KR; // 型チェック用
// _ = es_ES; // 型チェック用
// _ = hi_IN; // 型チェック用

// 翻訳辞書をロケール形式で登録
const TRANSLATIONS: Record<string, object> = {
	"ar-AE": ar_SA,
	"ar-DZ": ar_SA,
	"ar-YE": ar_SA,
	"ar-IQ": ar_SA,
	"ar-EG": ar_SA,
	"ar-OM": ar_SA,
	"ar-QA": ar_SA,
	"ar-KW": ar_SA,
	"ar-SA": ar_SA,
	"ar-SY": ar_SA,
	"ar-TN": ar_SA,
	"ar-BH": ar_SA,
	"ar-MA": ar_SA,
	"ar-JO": ar_SA,
	"ar-LY": ar_SA,
	"ar-LB": ar_SA,
	ar: ar_SA,
	"en-IE": en_US,
	"en-IN": en_US,
	"en-AU": en_US,
	"en-CA": en_US,
	"en-029": en_US,
	"en-JM": en_US,
	"en-SG": en_US,
	"en-ZW": en_US,
	"en-TT": en_US,
	"en-NZ": en_US,
	"en-PH": en_US,
	"en-BZ": en_US,
	"en-MY": en_US,
	"en-GB": en_US,
	"en-ZA": en_US,
	"en-US": en_US,
	en: en_US,
	"hi-IN": hi_IN,
	hi: hi_IN,
	"es-AR": es_ES,
	"es-UY": es_ES,
	"es-EC": es_ES,
	"es-SV": es_ES,
	"es-GT": es_ES,
	"es-CR": es_ES,
	"es-CO": es_ES,
	"es-ES": es_ES,
	"es-CL": es_ES,
	"es-DO": es_ES,
	"es-NI": es_ES,
	"es-PA": es_ES,
	"es-PY": es_ES,
	"es-PR": es_ES,
	"es-VE": es_ES,
	"es-PE": es_ES,
	"es-BO": es_ES,
	"es-HN": es_ES,
	"es-MX": es_ES,
	"es-US": es_ES,
	es: es_ES,
	"fr-CA": fr_FR,
	"fr-CH": fr_FR,
	"fr-FR": fr_FR,
	"fr-BE": fr_FR,
	"fr-MC": fr_FR,
	"fr-LU": fr_FR,
	fr: fr_FR,
	"ja-JP": ja_JP,
	ja: ja_JP,
	"ko-KR": ko_KR,
	ko: ko_KR,
	"zh-Hans": zh_CN,
	"zh-SG": zh_CN,
	"zh-CN": zh_CN,
	"zh-Hant": zh_CN,
	"zh-HK": zh_CN,
	"zh-TW": zh_CN,
	"zh-MO": zh_CN,
	zh: zh_CN,
};

// サポートされているロケール一覧を公開
export const I18N_SUPPORTED_LOCALES = Object.keys(TRANSLATIONS);

// i18n インスタンスの生成と初期化
const i18n = new I18n(TRANSLATIONS);
i18n.enableFallback = true;
i18n.defaultLocale = "en-US";

/**
 * ユーザーが選択したロケールから適切な翻訳ロケールを解決する。
 * - 完全一致（例: ja-JP）
 * - 言語コード一致（例: ja）
 * - 該当なし → 'en-US'
 *
 * @param locale 任意のロケール文字列（例: "ja-JP", "fr"）
 * @returns i18n-js に適したロケールキー
 */
export function getResolvedLocale(locale?: string): string {
	if (!locale) return i18n.defaultLocale;

	const normalized = locale.trim();

	// 完全一致があれば採用
	if (I18N_SUPPORTED_LOCALES.includes(normalized)) return normalized;

	// 言語コードベースのフォールバック（例: "ja" → "ja-JP"）
	const langCode = normalized.split("-")[0];
	const matched = I18N_SUPPORTED_LOCALES.find((l) => l.startsWith(langCode));
	return matched || i18n.defaultLocale;
}

export default i18n;
