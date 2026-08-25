import { PUBLIC_LOCALES, type PublicLocale } from "@shared/api/v1/constants/publicLocales";
import { isRtlLocale } from "@/lib/rtlLocales";

/**
 * 🌐 #1508 【設計】言語選択 UI に出す名称は、その言語自身のネイティブ名で固定する
 * （「日本語」「English」「Français」…）。i18n の翻訳辞書に載せない。
 *
 * 理由: これは「今表示している UI 言語での言語名」ではなく「その言語そのものの名前」。
 * 例えばフランス語 UI で日本語の選択肢を "japonais" と出すより、"日本語" と出す方が
 * 多くの言語選択 UI（iOS/Android の言語設定含む）の慣例に合い、どの言語からでも自分の
 * 母語を見つけやすい。
 */
export const LANGUAGE_DISPLAY_NAMES: Record<PublicLocale, string> = {
	"ja-JP": "日本語",
	"en-US": "English",
	"fr-FR": "Français",
	"zh-CN": "简体中文",
	"ar-SA": "العربية",
	"ko-KR": "한국어",
	"es-ES": "Español",
	"hi-IN": "हिन्दी",
};

/**
 * 言語切り替え UI に出す選択肢一覧。
 *
 * ⚠️ `ar-SA` を個別に除外しているのではなく、`PUBLIC_LOCALES` のうち `isRtlLocale` に
 * 当たるものを除外している（rtlLocales.ts 参照）。RTL 未対応の暫定仮定であり、
 * RTL レイアウト対応が入ったらここを外せる。
 */
export const SELECTABLE_LANGUAGE_LOCALES: PublicLocale[] = PUBLIC_LOCALES.filter((locale) => !isRtlLocale(locale));
