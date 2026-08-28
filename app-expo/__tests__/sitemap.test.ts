import { readFileSync } from "node:fs";
import path from "node:path";

import { PUBLIC_LOCALES } from "@/constants/seoLocales";
import { LEGAL_DOCUMENT_TYPES, LEGAL_SITEMAP_ROUTES } from "@/lib/legalRoute";
import {
	buildPageUrl,
	buildSitemapXml,
	SITEMAP_DEFAULT_BASE_URL,
	SITEMAP_ROUTES,
	SITEMAP_X_DEFAULT_LOCALE,
} from "@/lib/seo/sitemap";

/**
 * 🗺️ sitemap.xml の生成ロジック（#281）のテスト。
 *
 * 守りたいのは 3 つ。
 * 1. 全ロケール分の URL が出ること（ロケールを増やしたときに sitemap が置いていかれない）
 * 2. **載せてはいけない URL が混ざらないこと**（クエリ依存 / ログイン後 / 内部作業用）
 * 3. 出力が XML として壊れていないこと（壊れた sitemap は Search Console で丸ごと弾かれる）
 */

// ── XML パーサ（テスト用の最小実装）────────────────────────────────────────────
// app-expo の jest 環境は jest-environment-node（react-native の testEnvironment）なので
// DOMParser が無く、XML パーサも依存に無い。文字列の部分一致で検証すると
// 「タグが閉じていない XML」でも緑になってしまうため、整形式の検査を兼ねた最小パーサを置く。
// 想定外の構文（未閉鎖タグ / 対応しない終了タグ / 生の < や & / クォート無し属性）では必ず throw する。

type XmlNode = {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
};

const TAG_PATTERN = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*="[^"<]*")*)\s*(\/?)>/g;
const ATTR_PATTERN = /([A-Za-z_][\w.:-]*)="([^"<]*)"/g;
const VALID_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;

/** `&` が実体参照として正しく書かれているかを検査する（生の `&` は整形式違反） */
const assertEntitiesAreEscaped = (value: string, where: string): void => {
	const withoutEntities = value.replace(VALID_ENTITY_PATTERN, "");
	if (withoutEntities.includes("&")) throw new Error(`エスケープされていない & があります（${where}）: ${value}`);
};

const parseAttrs = (source: string, tagName: string): Record<string, string> => {
	const attrs: Record<string, string> = {};
	for (const match of source.matchAll(ATTR_PATTERN)) {
		const [, name, value] = match;
		if (name in attrs) throw new Error(`属性 ${name} が <${tagName}> に重複しています`);
		assertEntitiesAreEscaped(value, `<${tagName}> の ${name} 属性`);
		attrs[name] = value;
	}
	return attrs;
};

/**
 * XML を整形式チェックしながら木へ変換する。
 *
 * @param source XML 全文
 * @returns ルート要素
 * @throws 整形式でない場合
 */
const parseXml = (source: string): XmlNode => {
	const declaration = source.match(/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\?>\n/);
	if (!declaration) throw new Error('XML 宣言（<?xml version="1.0" encoding="UTF-8"?>）がありません');

	// コメントは整形式チェックの対象外なので、内容を検査したうえで取り除く
	const body = source.slice(declaration[0].length).replace(/<!--([\s\S]*?)-->/g, (_, inner: string) => {
		if (inner.includes("--")) throw new Error("コメント内に -- があります");
		return "";
	});

	const stack: XmlNode[] = [];
	let root: XmlNode | undefined;
	let cursor = 0;

	for (const match of body.matchAll(TAG_PATTERN)) {
		const [raw, closing, name, attrSource, selfClosing] = match;
		const gap = body.slice(cursor, match.index);
		if (gap.includes("<") || gap.includes(">")) throw new Error(`タグとして解釈できない断片があります: ${gap.trim()}`);
		assertEntitiesAreEscaped(gap, "テキストノード");
		if (stack.length > 0) stack[stack.length - 1].text += gap;
		else if (gap.trim() !== "") throw new Error(`ルート要素の外にテキストがあります: ${gap.trim()}`);
		cursor = (match.index ?? 0) + raw.length;

		if (closing === "/") {
			const open = stack.pop();
			if (!open) throw new Error(`対応する開始タグの無い </${name}> があります`);
			if (open.name !== name) throw new Error(`<${open.name}> が </${name}> で閉じられています`);
			continue;
		}

		const node: XmlNode = { name, attrs: parseAttrs(attrSource, name), children: [], text: "" };
		if (stack.length === 0) {
			if (root) throw new Error(`ルート要素が 2 つあります（<${root.name}> と <${name}>）`);
			root = node;
		} else {
			stack[stack.length - 1].children.push(node);
		}
		if (selfClosing !== "/") stack.push(node);
	}

	const trailing = body.slice(cursor);
	if (trailing.includes("<") || trailing.includes(">"))
		throw new Error(`末尾に解釈できない断片があります: ${trailing}`);
	if (trailing.trim() !== "") throw new Error(`ルート要素の外にテキストがあります: ${trailing.trim()}`);
	if (stack.length > 0) throw new Error(`閉じられていないタグがあります: <${stack.map((n) => n.name).join(">, <")}>`);
	if (!root) throw new Error("要素が 1 つもありません");
	return root;
};

// ── 以降のテストで共有する解析結果 ────────────────────────────────────────────

const xml = buildSitemapXml();
const urlset = parseXml(xml);
const urls = urlset.children.filter((child) => child.name === "url");
const locs = urls.map((url) => {
	const loc = url.children.find((child) => child.name === "loc");
	if (!loc) throw new Error("<loc> の無い <url> があります");
	return loc.text;
});
const alternatesOf = (url: XmlNode) => url.children.filter((child) => child.name === "xhtml:link");

describe("parseXml（このテスト自身の検査能力）", () => {
	// パーサが何も検出できないなら「パース可能な XML であること」のテストは無意味になるので、
	// 壊れた XML を実際に弾けることをここで固定する
	const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';

	it.each([
		["閉じられていないタグ", "<urlset><url></urlset>"],
		["対応しない終了タグ", "<urlset></url></urlset>"],
		["ルート要素が 2 つ", "<urlset/><urlset/>"],
		["エスケープされていない &", "<urlset><loc>a&b</loc></urlset>"],
		["クォートの無い属性", "<urlset xmlns=abc></urlset>"],
		["ルート要素の外のテキスト", "<urlset/>trailing"],
	])("%s を弾く", (_label, body) => {
		expect(() => parseXml(`${declaration}${body}`)).toThrow();
	});

	it("XML 宣言が無ければ弾く", () => {
		expect(() => parseXml("<urlset/>")).toThrow(/XML 宣言/);
	});
});

describe("buildSitemapXml", () => {
	it("パース可能な XML で、sitemap プロトコルの urlset を持つ", () => {
		// parseXml 自体が整形式チェック（ここまで到達した時点で throw していない）
		expect(urlset.name).toBe("urlset");
		expect(urlset.attrs.xmlns).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
		expect(urlset.attrs["xmlns:xhtml"]).toBe("http://www.w3.org/1999/xhtml");
		expect(xml.endsWith("</urlset>\n")).toBe(true);
	});

	it("全ロケール × 全ルートの URL を出力する", () => {
		expect(PUBLIC_LOCALES).toHaveLength(8);

		const expected = SITEMAP_ROUTES.flatMap((route) =>
			PUBLIC_LOCALES.map((locale) => buildPageUrl(SITEMAP_DEFAULT_BASE_URL, locale, route)),
		);
		expect(locs).toEqual(expected);
		expect(new Set(locs).size).toBe(locs.length); // 重複した <loc> はクロール予算の無駄
	});

	it("ロケール一覧はハードコードではなく PUBLIC_LOCALES に追従する", () => {
		const added = [...PUBLIC_LOCALES, "de-DE"];
		const withExtraLocale = parseXml(buildSitemapXml({ locales: added }));
		const extraLocaleLocs = withExtraLocale.children
			.flatMap((url) => url.children)
			.filter((child) => child.name === "loc")
			.map((loc) => loc.text)
			.filter((loc) => loc.includes("/de-DE"));
		expect(extraLocaleLocs).toHaveLength(SITEMAP_ROUTES.length);
	});

	// #281 ここが本題。「載っていて欲しくない URL」は増えたことに気付きにくいので固定する
	it.each([
		["posts", "?ids= のクエリ前提で、クエリ無しでは対象が決まらない（#721）"],
		["profile", "ログイン後の個人ページ"],
		["profile/blocked-dish-categories", "ログイン後の個人ページ"],
		["profile/device-settings", "端末に閉じた設定画面。検索から人間が踏む入口ではない（#1504）"],
		["notifications", "ログイン後の個人ページ"],
		["notifications/feed", "ログイン後の個人ページ"],
		["auth/callback", "OAuth のコールバック。人間の入口ではない"],
		["auth/login", "アプリ内のログイン導線から push される画面。人間の入口ではない（#1359）"],
		["sns-import", "共有された URL（?url=）前提の画面。クエリ無しでは対象が決まらない（#1400）"],
		["contribution-tasks/dish-copy-survey", "内部作業用"],
		["contribution-tasks/dish-category-image-review", "内部作業用"],
	])("除外ルート %s を含まない（理由: %s）", (route) => {
		expect(SITEMAP_ROUTES).not.toContain(route);
		const forbidden = PUBLIC_LOCALES.map((locale) => `/${locale}/${route}`);
		for (const loc of locs) {
			expect(forbidden.some((suffix) => loc.endsWith(suffix))).toBe(false);
		}
	});

	// #1368 逆に「載っていて欲しい URL」も固定する。法務ページは `auth/login` と逆の判断で、
	// ストア審査・問い合わせ・外部サイト・検索結果から **人間が入口として踏む** URL だから載せる。
	// 落ちた場合に疑うのは 2 つ: SITEMAP_ROUTES から外れた / LEGAL_DOCUMENT_TYPES が減った
	it("法務ページ（legal/*）を全文書 × 全ロケール分だけ載せる", () => {
		expect(LEGAL_SITEMAP_ROUTES).toHaveLength(4);

		for (const route of LEGAL_SITEMAP_ROUTES) {
			expect(SITEMAP_ROUTES).toContain(route);
			for (const locale of PUBLIC_LOCALES) {
				expect(locs).toContain(buildPageUrl(SITEMAP_DEFAULT_BASE_URL, locale, route));
			}
		}
	});

	// ⚠️ sitemap に載る以上、その URL には «実体の HTML» が要る。動的セグメント `[doc]` は
	// `app/[locale]/legal/[doc].tsx` の generateStaticParams が展開して初めて prerender される。
	// 展開漏れがあると、載せた URL が空の SPA シェルとしてクローラへ提出される（#721 の症状 b）
	it("sitemap の legal/* と prerender される doc が一致する", () => {
		expect([...LEGAL_SITEMAP_ROUTES]).toEqual(LEGAL_DOCUMENT_TYPES.map((doc) => `legal/${doc}`));
	});

	it("各 URL に全ロケールの hreflang を相互参照させる", () => {
		for (const url of urls) {
			const alternates = alternatesOf(url);
			// 全ロケール + x-default
			expect(alternates).toHaveLength(PUBLIC_LOCALES.length + 1);
			expect(alternates.map((link) => link.attrs.hreflang)).toEqual([...PUBLIC_LOCALES, "x-default"]);
			for (const link of alternates) {
				expect(link.attrs.rel).toBe("alternate");
				expect(locs).toContain(link.attrs.href); // 相互参照先は必ず sitemap 内の URL
			}
		}
	});

	it("x-default は en-US を指す", () => {
		expect(SITEMAP_X_DEFAULT_LOCALE).toBe("en-US");

		for (const url of urls) {
			const xDefaults = alternatesOf(url).filter((link) => link.attrs.hreflang === "x-default");
			expect(xDefaults).toHaveLength(1);

			const enUs = alternatesOf(url).find((link) => link.attrs.hreflang === "en-US");
			expect(xDefaults[0].attrs.href).toBe(enUs?.attrs.href);
			expect(xDefaults[0].attrs.href).toMatch(/\/en-US(\/|$)/);
		}
	});

	it("<loc> は canonical と同じ形（末尾スラッシュ無し・locale prefix 付き）で出す", () => {
		// SeoHeadRenderer.web.tsx の buildCanonical() は末尾スラッシュを落とす。
		// canonical と 1 文字でも違う URL は sitemap から採用されない
		for (const loc of locs) {
			expect(loc.startsWith(`${SITEMAP_DEFAULT_BASE_URL}/`)).toBe(true);
			expect(loc.endsWith("/")).toBe(false);
			expect(loc).toMatch(new RegExp(`^${SITEMAP_DEFAULT_BASE_URL}/(${PUBLIC_LOCALES.join("|")})(/|$)`));
		}
	});

	it("<lastmod> は出力しない", () => {
		// 静的 export に更新日の根拠が無い。ビルド日時を入れると全ページが毎回更新扱いになる
		expect(xml).not.toContain("<lastmod>");
	});

	it("baseUrl の末尾スラッシュを正規化する", () => {
		// baseUrl 末尾の "/" と locale の間で "//" にならないこと。
		// ロケールのトップ（`""`）は #721 の実測で実体が無いと分かったため
		// SITEMAP_ROUTES から外してある。実在するルートで同じ不変条件を固定する。
		expect(buildSitemapXml({ baseUrl: "https://example.test/" })).toContain(
			"<loc>https://example.test/ja-JP/search</loc>",
		);
	});

	it("URL を 1 件も出せない条件では throw する", () => {
		// 「空の sitemap を黙って生成する」が一番まずい壊れ方なので、必ず落とす
		expect(() => buildSitemapXml({ locales: [] })).toThrow(/locales が空/);
		expect(() => buildSitemapXml({ routes: [] })).toThrow(/routes が空/);
		expect(() => buildSitemapXml({ baseUrl: "/" })).toThrow(/baseUrl が空/);
	});

	it("x-default が locales に無いロケールを指す場合は throw する", () => {
		expect(() => buildSitemapXml({ xDefaultLocale: "de-DE" })).toThrow(/x-default/);
	});

	it("XML の特殊文字をエスケープする", () => {
		const escaped = buildSitemapXml({ baseUrl: "https://example.test", routes: ["a&b"], locales: ["en-US"] });
		expect(escaped).toContain("<loc>https://example.test/en-US/a&amp;b</loc>");
		expect(() => parseXml(escaped)).not.toThrow();
	});
});

describe("public/ に置く静的ファイル", () => {
	const publicDir = path.join(__dirname, "..", "public");

	it("コミット済みの sitemap.xml が生成結果と一致する", () => {
		// build:web が生成し直すので実害は出にくいが、レビューで見えている内容と
		// 実際に配信される内容がずれるのは避けたい（`generate:sitemap --check` と同じ検査）
		expect(readFileSync(path.join(publicDir, "sitemap.xml"), "utf8")).toBe(xml);
	});

	it("robots.txt が sitemap を参照している", () => {
		const robots = readFileSync(path.join(publicDir, "robots.txt"), "utf8");
		expect(robots).toContain("User-agent: *");
		expect(robots).toContain("Allow: /");
		expect(robots).toContain(`Sitemap: ${SITEMAP_DEFAULT_BASE_URL}/sitemap.xml`);
		expect(robots).not.toContain("Disallow: /");
	});
});
