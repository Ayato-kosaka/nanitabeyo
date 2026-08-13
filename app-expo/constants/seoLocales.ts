import { Env } from "@/constants/Env";
import type { SeoData } from "@/contexts/SeoContext";
import {
	DEFAULT_PUBLIC_LOCALE,
	PUBLIC_LOCALES,
	isPublicLocale,
	resolvePublicLocale,
	toOgLocale,
	type PublicLocale,
} from "@shared/api/v1/constants/publicLocales";

/**
 * SEO用の公開ロケール定義
 *
 * I18N_SUPPORTED_LOCALES には alias（en, en-NZ, ja, fr 等）が含まれるが、
 * SEO用途（hreflang/canonical/og:locale）では URL prefix と完全一致する
 * ロケールのみを使用する。
 *
 * URL 設計: https://app.nanitabeyo.net/{locale}/...
 * 例: /ja-JP/posts/123, /en-US/posts/123
 *
 * ⚠️ #721 ロケール一覧そのものは `shared/api/v1/constants/publicLocales.ts` へ移した。
 * 共有リンク（`/s/:token`）の `preview_locale` を **API 側で validation する**必要があり、
 * api は app-expo を import できないため。ここは app 側の import パスを変えないための
 * 再 export と、app 固有の SEO 文言だけを持つ。
 * **一覧をこのファイルへ複製し直さないこと**（#281 で sitemap 生成器が 2 本になった事故と同型）。
 */
export { PUBLIC_LOCALES, DEFAULT_PUBLIC_LOCALE, isPublicLocale, resolvePublicLocale, toOgLocale };
export type { PublicLocale };

const WEB_BASE_URL = Env.WEB_BASE_URL;

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

export const DEFAULT_SEO_BY_PUBLIC_LOCALE: Record<PublicLocale, SeoData> = {
	"ja-JP": {
		title: "なに食べよ ~食べたい料理が見つかる新感覚グルメアプリ~",
		description:
			"あなたの気分を入力すると、AIが「これ食べたいでしょ！」という料理を提案してくれます。提案された料理写真やレビューを見ながら、直感的にお店を選べます。",
		image: `${WEB_BASE_URL}/og/ja-JP.jpg`,
		imageAlt: "なに食べよ ~食べたい料理が見つかる新感覚グルメアプリ~",
		siteName: SITE_NAME_BY_PUBLIC_LOCALE["ja-JP"],
	},
	"en-US": {
		title: "CraveCatch - Find your dish",
		description:
			"Simply tell the app how you feel, and our AI will suggest dishes you'll likely crave. Then browse real food photos and reviews to instantly pick a restaurant that feels right.",
		image: `${WEB_BASE_URL}/og/en-US.jpg`,
		imageAlt: "CraveCatch - Find your dish",
		siteName: SITE_NAME_BY_PUBLIC_LOCALE["en-US"],
	},
	"fr-FR": {
		title: "CraveCatch - Find your dish",
		description:
			"Indique simplement à l’application ce que vous ressentez, et notre IA vous proposera des plats que vous aurez probablement envie de déguster. Parcourez ensuite de vraies photos de plats et des avis pour choisir instantanément le restaurant qui vous convient.",
		image: `${WEB_BASE_URL}/og/fr-FR.jpg`,
		imageAlt: "CraveCatch - Find your dish",
		siteName: SITE_NAME_BY_PUBLIC_LOCALE["fr-FR"],
	},
	"zh-CN": {
		title: "CraveCatch - Find your dish",
		description:
			"只需告诉应用你的心情，我们的 AI 就会推荐你可能想吃的菜。然后浏览真实的美食照片和评论，立即选择一个合适的餐厅。",
		image: `${WEB_BASE_URL}/og/zh-CN.jpg`,
		imageAlt: "CraveCatch - Find your dish",
		siteName: SITE_NAME_BY_PUBLIC_LOCALE["zh-CN"],
	},
	"ar-SA": {
		title: "CraveCatch - Find your dish",
		description:
			"ما عليك سوى إخبار التطبيق بما تشعر به، وسيقترح لك ذكاؤنا الاصطناعي الأطباق التي قد تشتهيها. ثم تصفح صور الطعام الحقيقية والمراجعات لاختيار المطعم الذي يبدو مناسبًا على الفور.",
		image: `${WEB_BASE_URL}/og/ar-SA.jpg`,
		imageAlt: "CraveCatch - Find your dish",
		siteName: SITE_NAME_BY_PUBLIC_LOCALE["ar-SA"],
	},
	"ko-KR": {
		title: "CraveCatch - Find your dish",
		description:
			"앱에 지금 기분을 말하면 AI가 당신이 먹고 싶어 할 만한 요리를 추천해 줍니다. 그런 다음 실제 음식 사진과 리뷰를 보며 마음에 드는 식당을 바로 선택하세요.",
		image: `${WEB_BASE_URL}/og/ko-KR.jpg`,
		imageAlt: "CraveCatch - Find your dish",
		siteName: SITE_NAME_BY_PUBLIC_LOCALE["ko-KR"],
	},
	"es-ES": {
		title: "CraveCatch - Find your dish",
		description:
			"Simplemente dile a la app cómo te sientes y nuestra IA te sugerirá los platos que probablemente se te antojen. Luego, explora fotos reales de comida y reseñas para elegir al instante el restaurante que te parezca adecuado.",
		image: `${WEB_BASE_URL}/og/es-ES.jpg`,
		imageAlt: "CraveCatch - Find your dish",
		siteName: SITE_NAME_BY_PUBLIC_LOCALE["es-ES"],
	},
	"hi-IN": {
		title: "CraveCatch - Find your dish",
		description:
			"बस ऐप को बताएं कि आप कैसा महसूस कर रहे हैं और हमारी AI आपको वे व्यंजन सुझाएगी जिन्हें आप शायद पसंद करेंगे। फिर असली भोजन की तस्वीरें और समीक्षाएँ देखकर तुरंत वह रेस्तरां चुनें जो आपको सही लगे।",
		image: `${WEB_BASE_URL}/og/hi-IN.jpg`,
		imageAlt: "CraveCatch - Find your dish",
		siteName: SITE_NAME_BY_PUBLIC_LOCALE["hi-IN"],
	},
};

/**
 * 🗳 友達投票の共有 URL 用の静的 SEO。
 *
 * ## なぜ «別立て» が要るのか（実機フィードバック）
 * 投票の共有 URL は `[shareToken]` が動的セグメントなので prerender で内容を差し込めず、
 * `DEFAULT_SEO_BY_PUBLIC_LOCALE`（アプリ全体の紹介文）がそのまま OGP になっていた。
 * その結果 LINE に貼っても **「なに食べよ ~食べたい料理が見つかる～」というアプリ紹介**が出て、
 * 受け取った側は «友達投票への招待» だと分からなかった。
 *
 * token ごとの動的 OGP（誰が・どの料理で、まで出す）は `/s/:token` の Cloud Run SSR が担当する。
 * こちらは **静的で良い**というオーナー判断のもと、「投票への招待」だと分かる文言までを持たせる。
 *
 * ⚠️ `image` は敢えて持たない。ロケール既定の OG 画像を使い回す。
 * 投票専用の画像を足すなら `app-expo/public/og/` に 8 枚（1200x630）追加してからにすること。
 * ここだけ差し替えて画像が 404 になると、**OGP ごと表示されなくなる**（SNS は 1 枚でも欠けると
 * カード自体を出さないことがある）。
 */
export const VOTE_SEO_BY_PUBLIC_LOCALE: Record<PublicLocale, Pick<SeoData, "title" | "description">> = {
	"ja-JP": {
		title: "友達と投票して、今日食べる料理を決めよう",
		description: "候補の料理を見ながらタップで投票するだけ。みんなの投票が集まると、全員の気分に合うお店が決まります。",
	},
	"en-US": {
		title: "Vote with friends and decide what to eat",
		description:
			"Just tap to vote on the dishes you like. Once everyone has voted, you get the restaurant that fits the whole group.",
	},
	"fr-FR": {
		title: "Votez entre amis pour choisir quoi manger",
		description:
			"Votez d’un simple geste pour les plats qui vous tentent. Une fois tous les votes réunis, le restaurant qui convient à tout le groupe apparaît.",
	},
	"zh-CN": {
		title: "和朋友一起投票，决定今天吃什么",
		description: "看着菜品照片点一下就能投票。大家投完之后，就会得出适合所有人的餐厅。",
	},
	"ar-SA": {
		title: "صوّت مع أصدقائك لتحديد ما ستأكلونه",
		description: "صوّت بلمسة واحدة للأطباق التي تعجبك. وبعد تصويت الجميع، يظهر لكم المطعم الذي يناسب المجموعة كلها.",
	},
	"ko-KR": {
		title: "친구들과 투표해서 오늘 먹을 요리를 정해요",
		description: "마음에 드는 요리를 탭해서 투표하면 끝. 모두의 투표가 모이면 다 같이 갈 만한 가게가 정해집니다.",
	},
	"es-ES": {
		title: "Votad entre amigos y decidid qué comer",
		description:
			"Vota con un toque los platos que te apetecen. Cuando todos hayan votado, aparecerá el restaurante que encaja con todo el grupo.",
	},
	"hi-IN": {
		title: "दोस्तों के साथ वोट करके तय करें कि आज क्या खाना है",
		description:
			"जो व्यंजन पसंद हों उन्हें टैप करके वोट करें। सबके वोट आने के बाद पूरे ग्रुप के लिए सही रेस्टोरेंट मिल जाएगा।",
	},
};

/**
 * 友達投票の共有 URL か（ロケールの有無に依存しない）。
 *
 * 例: `/ja-JP/search/dish-category-group-votes/<token>/vote`
 */
const VOTE_PATH_PATTERN = /\/search\/dish-category-group-votes(\/|$)/;

/**
 * パスに応じた «静的な» SEO 既定値を返す。
 *
 * ## ⚠️ これはレンダー時に決まらなければ意味がない
 * `useSeo` は `useFocusEffect` の中で push するため、**expo export の prerender では一切走らない**。
 * つまり画面側で `useSeo` を書いても、SNS のクローラが読む初回 HTML には反映されない。
 * ここを `[locale]/_layout.tsx` の `seoDefaults`（レンダー時に評価される useMemo）から呼ぶことで、
 * prerender 済み HTML に載る。
 *
 * 実行時の上書き（`useSeo`）は従来どおりこの既定値の上に乗る。
 */
export function resolveStaticSeoForPath(locale: PublicLocale, pathname: string): SeoData {
	const base = DEFAULT_SEO_BY_PUBLIC_LOCALE[locale];
	if (!VOTE_PATH_PATTERN.test(pathname)) return base;

	const vote = VOTE_SEO_BY_PUBLIC_LOCALE[locale];
	return { ...base, title: vote.title, description: vote.description, imageAlt: vote.title };
}
