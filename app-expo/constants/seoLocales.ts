import { Env } from "@/constants/Env";
import type { SeoData } from "@/contexts/SeoContext";

/**
 * SEO用の公開ロケール定義
 *
 * I18N_SUPPORTED_LOCALES には alias（en, en-NZ, ja, fr 等）が含まれるが、
 * SEO用途（hreflang/canonical/og:locale）では URL prefix と完全一致する
 * ロケールのみを使用する。
 *
 * URL 設計: https://app.nanitabeyo.net/{locale}/...
 * 例: /ja-JP/posts/123, /en-US/posts/123
 */

/**
 * 公開されているロケール一覧（URL prefix として使用される形式）
 */
export const PUBLIC_LOCALES = ["ja-JP", "en-US", "fr-FR", "zh-CN", "ar-SA", "ko-KR", "es-ES", "hi-IN"] as const;

/**
 * デフォルトの公開ロケール
 * x-default hreflang や、ロケール不明時のフォールバックに使用
 */
export const DEFAULT_PUBLIC_LOCALE = "ja-JP";

export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

const WEB_BASE_URL = Env.WEB_BASE_URL;

export const DEFAULT_SEO_BY_PUBLIC_LOCALE: Record<PublicLocale, SeoData> = {
	"ja-JP": {
		title: "なに食べよ ~食べたい料理が見つかる新感覚グルメアプリ~",
		description:
			"あなたの気分を入力すると、AIが「これ食べたいでしょ！」という料理を提案してくれます。提案された料理写真やレビューを見ながら、直感的にお店を選べます。",
		image: `${WEB_BASE_URL}/og/ja-JP.jpg`,
	},
	"en-US": {
		title: "CraveCatch - Find your dish",
		description:
			"Simply tell the app how you feel, and our AI will suggest dishes you'll likely crave. Then browse real food photos and reviews to instantly pick a restaurant that feels right.",
		image: `${WEB_BASE_URL}/og/en-US.jpg`,
	},
	"fr-FR": {
		title: "CraveCatch - Find your dish",
		description:
			"Indique simplement à l’application ce que vous ressentez, et notre IA vous proposera des plats que vous aurez probablement envie de déguster. Parcourez ensuite de vraies photos de plats et des avis pour choisir instantanément le restaurant qui vous convient.",
		image: `${WEB_BASE_URL}/og/fr-FR.jpg`,
	},
	"zh-CN": {
		title: "CraveCatch - Find your dish",
		description: "只需告诉应用你的心情，我们的 AI 就会推荐你可能想吃的菜。然后浏览真实的美食照片和评论，立即选择一个合适的餐厅。",
		image: `${WEB_BASE_URL}/og/zh-CN.jpg`,
	},
	"ar-SA": {
		title: "CraveCatch - Find your dish",
		description:
			"ما عليك سوى إخبار التطبيق بما تشعر به، وسيقترح لك ذكاؤنا الاصطناعي الأطباق التي قد تشتهيها. ثم تصفح صور الطعام الحقيقية والمراجعات لاختيار المطعم الذي يبدو مناسبًا على الفور.",
		image: `${WEB_BASE_URL}/og/ar-SA.jpg`,
	},
	"ko-KR": {
		title: "CraveCatch - Find your dish",
		description:
			"앱에 지금 기분을 말하면 AI가 당신이 먹고 싶어 할 만한 요리를 추천해 줍니다. 그런 다음 실제 음식 사진과 리뷰를 보며 마음에 드는 식당을 바로 선택하세요.",
		image: `${WEB_BASE_URL}/og/ko-KR.jpg`,
	},
	"es-ES": {
		title: "CraveCatch - Find your dish",
		description:
			"Simplemente dile a la app cómo te sientes y nuestra IA te sugerirá los platos que probablemente se te antojen. Luego, explora fotos reales de comida y reseñas para elegir al instante el restaurante que te parezca adecuado.",
		image: `${WEB_BASE_URL}/og/es-ES.jpg`,
	},
	"hi-IN": {
		title: "CraveCatch - Find your dish",
		description:
			"बस ऐप को बताएं कि आप कैसा महसूस कर रहे हैं और हमारी AI आपको वे व्यंजन सुझाएगी जिन्हें आप शायद पसंद करेंगे। फिर असली भोजन की तस्वीरें और समीक्षाएँ देखकर तुरंत वह रेस्तरां चुनें जो आपको सही लगे।",
		image: `${WEB_BASE_URL}/og/hi-IN.jpg`,
	},
};

export const SITE_NAME_BY_PUBLIC_LOCALE: Record<PublicLocale, string> = {
	"ja-JP": "なに食べよ",
	"en-US": "CraveCatch",
	"fr-FR": "CraveCatch",
	"zh-CN": "CraveCatch",
	"ar-SA": "CraveCatch",
	"ko-KR": "CraveCatch",
	"es-ES": "CraveCatch",
	"hi-IN": "CraveCatch",
};

export function resolvePublicLocale(locale?: string): PublicLocale {
	if (!locale) return DEFAULT_PUBLIC_LOCALE;
	const normalized = locale.trim();
	if (PUBLIC_LOCALES.includes(normalized as PublicLocale)) {
		return normalized as PublicLocale;
	}
	const lang = normalized.split("-")[0];
	const matched = PUBLIC_LOCALES.find((l) => l.startsWith(lang));
	return matched ?? DEFAULT_PUBLIC_LOCALE;
}
