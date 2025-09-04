// app/_seo.tsx
import { usePathname, useSegments } from "expo-router";
import { Env } from "@/constants/Env";
import i18n, { I18N_SUPPORTED_LOCALES } from "@/lib/i18n";

const WEB_BASE_URL = Env.WEB_BASE_URL;
const DEFAULT_LOCALE = "ja";
const TWITTER_SITE = "nanitabeyo";

export function ogLocale(locale: string) {
	const map: Record<string, string> = I18N_SUPPORTED_LOCALES.reduce(
		(acc, cur) => {
			const [lang, region] = cur.split("-");
			acc[cur] = `${lang}_${(region || lang).toUpperCase()}`;
			return acc;
		},
		{} as Record<string, string>,
	);
	return map[locale] || `${locale}_${locale.toUpperCase()}`;
}

export function useLocaleFromRoute(): string {
	const segs = useSegments(); // ['ja', '...', '...'] など
	const maybe = (segs?.[0] ?? "").replace(/\(.+\)/, ""); // (tabs) などを除去
	return I18N_SUPPORTED_LOCALES.includes(maybe) ? maybe : DEFAULT_LOCALE;
}

export function stripLocaleFromPath(path: string, locale: string) {
	// '/ja/posts/123' -> '/posts/123'（先頭だけ）
	return path.replace(new RegExp(`^/${locale}(?=/|$)`), "") || "/";
}

export function buildCanonical(pathNoLocale: string, locale: string) {
	// 各ロケールの本番 URL を /{locale}/path で正規化（デフォルト言語も prefix 付ける方針）
	const p = pathNoLocale.startsWith("/") ? pathNoLocale : `/${pathNoLocale}`;
	return `${WEB_BASE_URL}/${locale}${p}`.replace(/\/+$/, "");
}

type SeoProps = {
	title?: string;
	description?: string;
	image?: string; // できれば絶対URL
	imageAlt?: string; // 代替テキスト
	robots?: string; // 例: 'noindex, nofollow'
};

export function SeoHead(props: SeoProps) {
	const pathname = usePathname() || "/";
	const locale = useLocaleFromRoute();
	const pathNoLocale = stripLocaleFromPath(pathname, locale);

	const title = props.title || i18n.t("Common.defaultTitle");
	const desc = props.description || i18n.t("Common.defaultDesc");
	const img = props.image || `${WEB_BASE_URL}/og/default.png`;
	const imgAlt = props.imageAlt || title;
	const canonical = buildCanonical(pathNoLocale, locale);

	const og = {
		url: canonical,
		site_name: i18n.t("Common.site"),
		locale: ogLocale(locale),
		imgW: "1200",
		imgH: "630",
	};

	// その他ロケール（alternate）
	const otherLocales = I18N_SUPPORTED_LOCALES.filter((l) => l !== locale);

	// twitter:domain 用のホスト
	const host = (() => {
		try {
			return new URL(WEB_BASE_URL).host;
		} catch {
			return "";
		}
	})();

	return <></>;
}
