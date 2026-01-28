/**
 * SEO Head Renderer (Web専用)
 *
 * #717 【設計】expo-router/head を使った唯一のHead出力点
 * - canonical: pathnameから自動生成
 * - hreflang: PUBLIC_LOCALES のみ出力（alias排除）
 * - og:locale/alternate: PUBLIC_LOCALES に対応
 * - twitter基本設定
 * - title/description/og/twitter は defaults + 上書きで構成
 */

import Head from "expo-router/head";
import { usePathname } from "expo-router";
import { useSeoContext } from "./SeoProvider";
import { PUBLIC_LOCALES, DEFAULT_PUBLIC_LOCALE, PublicLocale, resolvePublicLocale } from "@/constants/seoLocales";
import { Env } from "@/constants/Env";
import { useLocale } from "@/hooks/useLocale";

const WEB_BASE_URL = Env.WEB_BASE_URL;
const TWITTER_SITE = "@nanitabeyo";

/**
 * og:locale 形式に変換（ja-JP → ja_JP）
 */
function ogLocaleFormat(locale: string): string {
	const [lang, region] = locale.split("-");
	return `${lang}_${(region || lang).toUpperCase()}`;
}

/**
 * pathnameからlocale部分を除去
 * 例: /ja-JP/posts/123 → /posts/123
 */
function stripLocaleFromPath(pathname: string, locale: string): string {
	return pathname.replace(new RegExp(`^/${locale}(?=/|$)`), "") || "/";
}

/**
 * canonical URL を生成
 * 例: /posts/123, ja-JP → https://app.nanitabeyo.net/ja-JP/posts/123
 */
function buildCanonical(pathNoLocale: string, locale: string): string {
	const p = pathNoLocale.startsWith("/") ? pathNoLocale : `/${pathNoLocale}`;
	return `${WEB_BASE_URL}/${locale}${p}`.replace(/\/+$/, "");
}

export default function SeoHeadRenderer() {
	const { current } = useSeoContext();

	const pathname = usePathname() || "/";
	const { locale: rawLocale } = useLocale();
	const locale = resolvePublicLocale(rawLocale);

	// #717 【設計】pathname から locale 部分を除去して canonical を生成
	const pathNoLocale = stripLocaleFromPath(pathname, locale);
	const canonical = buildCanonical(pathNoLocale, locale);

	// #717 【設計】title/desc/image は current（defaults + 上書き）から取得
	const title = current.title;
	const description = current.description;
	const image = current.image;
	const imageAlt = current.imageAlt;
	const robots = current.robots;
	const siteName = current.siteName || "なに食べよ";

	// twitter:domain 用のホスト
	const host = (() => {
		try {
			return new URL(WEB_BASE_URL).host;
		} catch {
			return "";
		}
	})();

	return (
		<Head>
			{/* 基本 */}
			<title>{title}</title>
			<meta name="description" content={description} />
			<link rel="canonical" href={canonical} />
			{robots && <meta name="robots" content={robots} />}

			{/* #717 【設計】hreflang は PUBLIC_LOCALES のみ出力（alias排除） */}
			{PUBLIC_LOCALES.map((lng) => (
				<link key={lng} rel="alternate" hrefLang={lng} href={buildCanonical(pathNoLocale, lng)} />
			))}
			<link rel="alternate" hrefLang="x-default" href={buildCanonical(pathNoLocale, DEFAULT_PUBLIC_LOCALE)} />

			{/* Open Graph */}
			<meta property="og:type" content="website" />
			<meta property="og:site_name" content={siteName} />
			<meta property="og:title" content={title} />
			<meta property="og:description" content={description} />
			<meta property="og:url" content={canonical} />
			<meta property="og:image" content={image} />
			<meta property="og:image:alt" content={imageAlt} />
			<meta property="og:image:width" content="1200" />
			<meta property="og:image:height" content="630" />

			{/* #717 【設計】og:locale/alternate は PUBLIC_LOCALES のみ */}
			<meta property="og:locale" content={ogLocaleFormat(locale)} />
			{PUBLIC_LOCALES.filter((l) => l !== locale).map((lng) => (
				<meta key={lng} property="og:locale:alternate" content={ogLocaleFormat(lng)} />
			))}

			{/* Twitter */}
			<meta name="twitter:card" content="summary_large_image" />
			{host && <meta name="twitter:domain" content={host} />}
			{TWITTER_SITE && <meta name="twitter:site" content={TWITTER_SITE} />}
			<meta name="twitter:title" content={title} />
			<meta name="twitter:description" content={description} />
			<meta name="twitter:image" content={image} />
			<meta name="twitter:image:alt" content={imageAlt} />

			{/* ページ言語のヒント */}
			<meta httpEquiv="Content-Language" content={locale} />
		</Head>
	);
}
