import { PUBLIC_LOCALES } from "@/constants/seoLocales";
import { INDEXABLE_ROUTES } from "@/lib/seo/publicRoutes";

/**
 * 🗺️ sitemap.xml の生成ロジック（#281）。
 *
 * `scripts/generate-sitemap.mjs` がこのモジュールを読み込んで `public/sitemap.xml` を書き出す。
 * 手書きの静的ファイルにしないのは、**ページが増えたときに誰も直さないから**。
 *
 * ## なぜ「ルート定義から生成する」のか
 * 配信は Firebase Hosting で、公開ページの実体は firebase.json の rewrites に列挙されている。
 * ここ（`SITEMAP_ROUTES`）はその中から **検索結果に出したい URL だけ**を選んだ集合であり、
 * ロケールの掛け算は `PUBLIC_LOCALES` から機械的に行う。ロケールを増やしても sitemap は追従する。
 *
 * ## URL の形は canonical と一致させること
 * `contexts/SeoContext/SeoHeadRenderer.web.tsx` の `buildCanonical()` は
 * `${WEB_BASE_URL}/${locale}${path}` を作り、**末尾のスラッシュを落とす**。
 * sitemap の `<loc>` が canonical と 1 文字でも違うと「sitemap の URL は canonical ではない」
 * 扱いになりインデックスされない。だから同じ形（末尾スラッシュ無し）で組み立てる。
 *
 * ## `<lastmod>` を出さない理由
 * 静的 export の成果物には「そのページの内容が最後に変わった日」に相当する情報が無い。
 * ビルド日時を入れると全ページが毎回更新扱いになり、`<lastmod>` の信頼を失う（無い方がまし）。
 */

/**
 * sitemap に載せるルート（locale prefix より後ろのパス。空文字はロケールのトップ）。
 *
 * firebase.json の rewrites に在る静的ページのうち、以下は**意図的に除外**している。
 * 除外理由はテスト（`__tests__/sitemap.test.ts`）でも固定してあるので、
 * 足すときはここのコメントと合わせて更新すること。
 *
 * - `auth/callback` … OAuth のコールバック。人間が入口として踏む URL ではない
 * - `auth/login` … アプリ内のログイン導線から `?next=` 付きで push される画面（#1359）。
 *   `auth/callback` と同じく、人間が検索結果から入口として踏む URL ではない
 * - `contribution-tasks/*` … 内部作業用の画面
 * - `profile/*` / `notifications/*` … ログイン後の個人ページ（未ログインでは中身が無い）
 * - `posts` … `?ids=` のクエリ前提のページで、クエリ無しでは表示する対象が決まらない（#721）。
 *   sitemap に載せられる安定した URL が存在しない
 *
 * ⚠️ `""`（ロケールのトップ）と `search` は同じ検索画面を指す（tabs の initialRouteName が
 *    `search` のため）。`/` からのリダイレクト先が `/{locale}` であり、サイトの入口として
 *    落とせないので両方載せている。canonical はどちらも自分自身を指すので、
 *    どちらを正とするかは検索エンジン側の判断に委ねる。
 *
 * #1368 `legal/*`（ガイドライン / 利用規約 / プライバシーポリシー / 著作権）は **載せる**。
 * `auth/login` を外したのと逆の判断で、理由は「人間が入口として踏むか」の一点。
 * 法務ページはストア審査・問い合わせ・外部サイトからのリンク先として直接踏まれ、
 * 検索でも「<アプリ名> プライバシーポリシー」で探される。クエリにもログイン状態にも依存せず、
 * 8 ロケール分の実体が prerender される（`app/[locale]/legal/[doc].tsx` の generateStaticParams）。
 * 一覧を手で書かず `LEGAL_SITEMAP_ROUTES` から展開しているのは、文書を増やしたときに
 * ルートだけ増えて sitemap が置いていかれるのを防ぐため（このファイル冒頭の方針と同じ）。
 *
 * #1368 【既知の状態】**文書の実体は ja-JP と en-US の 2 ロケールだけ**で、他の 6 ロケールは
 * 英語へフォールバックする（features/settings/components/LegalDocument.tsx の `locale in
 * legalDocuments ? ... : legalDocuments["en-US"]`）。つまりここで展開している 32 URL のうち
 * 24 本は en-US と同一本文を返しつつ、hreflang では「ko-KR 版だ」と宣言することになる。
 * 翻訳が入るまでの既知の不一致として記録しておく（Search Console では
 * "Duplicate without user-selected canonical" として出る見込み）。
 * 翻訳を入れるか、実体のあるロケールへ展開を絞るかは、翻訳の予定が決まってから判断する。
 */
// #1503 実体は `lib/seo/publicRoutes.ts` へ移した。直リンクスモーク（e2e）と sitemap が
// 別々の一覧を持つと、ルートを足したときに片方だけ増える（#281 で生成器が 2 本になったのと同型の事故）。
// ここは «sitemap から見た名前» を保つための再 export で、選定の理由は上のコメントのまま。
export const SITEMAP_ROUTES: readonly string[] = INDEXABLE_ROUTES;

/**
 * #721 【重要】ロケールのトップ（`""` = `/en-US` など）は**意図的に外している**。
 *
 * `app/[locale]/` には `index.tsx` が無く（あるのは `_layout.tsx` / `+not-found.tsx` / `(tabs)/`）、
 * `expo export` は `dist/en-US/index.html` も `dist/en-US.html` も生成しない。
 * そのため `/en-US` は `cleanUrls` でヒットせず catch-all `**` → `/index.html` に落ち、
 * **title も description も canonical も無い空の SPA シェル**が返る。
 * これは Hosting エミュレータで実測した（PR #1182 の検証コメント）。
 *
 * 実体の無い URL を sitemap に載せると、8 ロケール分すべてが同一の空シェルとして
 * クローラへ提出されることになる。載せない方が正しい。
 *
 * ロケールのトップも検索結果に出したくなったら、先に `app/[locale]/index.tsx` を作って
 * 実体の HTML が生成されることを確認してから、ここへ `""` を戻すこと。
 */

/**
 * `hreflang="x-default"` が指すロケール。
 *
 * ⚠️ アプリの `<head>`（`SeoHeadRenderer.web.tsx`）は `DEFAULT_PUBLIC_LOCALE`（ja-JP）を
 *    x-default にしている。sitemap 側は #281 の指定どおり en-US を指す。
 *    「どの言語でもない訪問者向けの入口」としては英語が妥当という判断だが、
 *    head と sitemap で指す先が違う状態ではあるので、揃えるなら両方を同時に変えること。
 */
export const SITEMAP_X_DEFAULT_LOCALE = "en-US";

/** 本番の配信元。EXPO_PUBLIC_WEB_BASE_URL が無い環境（ローカル）でも生成できるようにする */
export const SITEMAP_DEFAULT_BASE_URL = "https://app.nanitabeyo.net";

export type BuildSitemapXmlOptions = {
	/** 末尾スラッシュ無しのオリジン（例: `https://app.nanitabeyo.net`） */
	baseUrl?: string;
	/** URL prefix として使うロケール一覧 */
	locales?: readonly string[];
	/** locale prefix より後ろのパス一覧 */
	routes?: readonly string[];
	/** `hreflang="x-default"` が指すロケール */
	xDefaultLocale?: string;
};

/** XML のテキスト／属性値に入れてはいけない文字を実体参照へ置き換える */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * canonical と同じ形の URL を組み立てる。
 *
 * @param baseUrl 末尾スラッシュ無しのオリジン
 * @param locale URL prefix のロケール（例: `ja-JP`）
 * @param route locale prefix より後ろのパス（空文字はロケールのトップ）
 * @returns 例: `https://app.nanitabeyo.net/ja-JP/review/selectRestaurant`
 */
export function buildPageUrl(baseUrl: string, locale: string, route: string): string {
	const path = route.replace(/^\/+/, "").replace(/\/+$/, "");
	return path ? `${baseUrl}/${locale}/${path}` : `${baseUrl}/${locale}`;
}

/**
 * sitemap.xml の中身を組み立てる。
 *
 * 各 URL には全ロケールの `<xhtml:link rel="alternate" hreflang="...">` を相互に張る。
 * 相互参照は**片方向だと無効**（A が B を指すなら B も A を指す必要がある）なので、
 * ロケールごとに同じ一覧を出力する。
 *
 * @param options 生成条件。既定値はこのリポジトリの公開ロケール／公開ルート
 * @returns sitemap.xml の全文（末尾は改行）
 * @throws ロケールが空、または x-default のロケールが一覧に無い場合
 */
export function buildSitemapXml(options: BuildSitemapXmlOptions = {}): string {
	const {
		baseUrl = SITEMAP_DEFAULT_BASE_URL,
		locales = PUBLIC_LOCALES,
		routes = SITEMAP_ROUTES,
		xDefaultLocale = SITEMAP_X_DEFAULT_LOCALE,
	} = options;

	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
	if (!normalizedBaseUrl) throw new Error("buildSitemapXml: baseUrl が空です。");
	if (locales.length === 0) throw new Error("buildSitemapXml: locales が空です。URL を 1 件も出力できません。");
	if (routes.length === 0) throw new Error("buildSitemapXml: routes が空です。URL を 1 件も出力できません。");
	// x-default が一覧に無いロケールを指すと、その URL はどの hreflang とも対応しない孤児になる
	if (!locales.includes(xDefaultLocale)) {
		throw new Error(
			`buildSitemapXml: x-default のロケール "${xDefaultLocale}" が locales（${locales.join(", ")}）に含まれていません。`,
		);
	}

	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		"<!-- このファイルは app-expo/scripts/generate-sitemap.mjs が生成します。手で編集しないでください。 -->",
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
	];

	for (const route of routes) {
		for (const locale of locales) {
			lines.push("\t<url>");
			lines.push(`\t\t<loc>${escapeXml(buildPageUrl(normalizedBaseUrl, locale, route))}</loc>`);
			for (const alternate of locales) {
				const href = escapeXml(buildPageUrl(normalizedBaseUrl, alternate, route));
				lines.push(`\t\t<xhtml:link rel="alternate" hreflang="${escapeXml(alternate)}" href="${href}" />`);
			}
			const xDefaultHref = escapeXml(buildPageUrl(normalizedBaseUrl, xDefaultLocale, route));
			lines.push(`\t\t<xhtml:link rel="alternate" hreflang="x-default" href="${xDefaultHref}" />`);
			lines.push("\t</url>");
		}
	}

	lines.push("</urlset>");
	return `${lines.join("\n")}\n`;
}
