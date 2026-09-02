import { readdirSync } from "node:fs";
import path from "node:path";

import {
	DEEP_LINK_SMOKE_EXCLUSIONS,
	DEEP_LINK_SMOKE_ROUTES,
	INDEXABLE_ROUTES,
	NON_INDEXABLE_DEEP_LINK_ROUTES,
} from "@/lib/seo/publicRoutes";
import { SITEMAP_ROUTES } from "@/lib/seo/sitemap";

/**
 * 🔗 公開ルート一覧（#1503）のテスト。
 *
 * 守りたいのは 1 点だけ。**ルートを足した人が一覧を更新し忘れても、CI が気づくこと。**
 *
 * REL-01 では公開 4 ルートの直リンクが全部白画面だったのに、e2e の直リンクスモークは
 * 手書きの 2 本しか持っていなかった。手で書いた一覧は増えないので、
 * 「ファイルとして存在するルート」と「一覧」を突き合わせる。
 */

/** 走査対象。タブ配下 = 直リンクで踏まれる公開画面の実体 */
const TABS_DIR = path.join(__dirname, "..", "app", "[locale]", "(tabs)");

/**
 * `app/[locale]/(tabs)/` 配下の **静的な**ルートを列挙する。
 *
 * - `_layout.tsx` はルートではない
 * - `[param]` を含むルートは、値が無いと URL を組み立てられないので対象外
 *   （動的ルートの直リンクは共有リンクの spec が担保している）
 * - `index.tsx` は親ディレクトリのパスそのもの
 *
 * @returns locale prefix より後ろのパス（例: `review/selectRestaurant`）
 */
const listStaticTabRoutes = (dir: string = TABS_DIR, prefix = ""): string[] => {
	const routes: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.includes("[")) continue; // 動的セグメント
		const next = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			routes.push(...listStaticTabRoutes(path.join(dir, entry.name), next));
			continue;
		}
		if (!entry.name.endsWith(".tsx")) continue;
		if (entry.name === "_layout.tsx") continue;
		const withoutExtension = next.replace(/\.tsx$/, "");
		routes.push(withoutExtension.replace(/(^|\/)index$/, ""));
	}
	return routes.filter((route) => route !== "");
};

describe("公開ルート一覧（lib/seo/publicRoutes.ts）", () => {
	it("スモーク対象は重複が無く、パスの形が揃っている", () => {
		expect(new Set(DEEP_LINK_SMOKE_ROUTES).size).toBe(DEEP_LINK_SMOKE_ROUTES.length);
		for (const route of DEEP_LINK_SMOKE_ROUTES) {
			expect(route).not.toMatch(/^\//); // 先頭スラッシュ無し（buildPageUrl / spec の組み立てと揃える）
			expect(route).not.toMatch(/\/$/);
			expect(route).not.toBe("");
		}
	});

	it("スモーク対象と除外リストは排他である", () => {
		const excluded = Object.keys(DEEP_LINK_SMOKE_EXCLUSIONS);
		expect(DEEP_LINK_SMOKE_ROUTES.filter((route) => excluded.includes(route))).toEqual([]);
	});

	it("除外には必ず理由が書かれている", () => {
		for (const [route, reason] of Object.entries(DEEP_LINK_SMOKE_EXCLUSIONS)) {
			expect(`${route}: ${reason}`.length).toBeGreaterThan(route.length + 10);
		}
	});

	// ⚠️ これが本命。ルートを足して一覧へ書き忘れると、ここが赤くなる。
	it("(tabs) 配下の静的ルートは、スモーク対象か除外リストのどちらかに必ず載っている", () => {
		const known = new Set<string>([...DEEP_LINK_SMOKE_ROUTES, ...Object.keys(DEEP_LINK_SMOKE_EXCLUSIONS)]);
		const missing = listStaticTabRoutes().filter((route) => !known.has(route));
		expect(missing).toEqual([]);
	});

	it("スモーク対象のうちタブ配下のルートは、実体のファイルが存在する", () => {
		const existing = new Set(listStaticTabRoutes());
		// legal/* は app/[locale]/legal/[doc].tsx（動的）が実体なので、この検査の対象外
		const tabRoutes = DEEP_LINK_SMOKE_ROUTES.filter((route) => !route.startsWith("legal/"));
		expect(tabRoutes.filter((route) => !existing.has(route))).toEqual([]);
	});

	it("sitemap のルートは INDEXABLE_ROUTES と同一（二重管理していない）", () => {
		expect(SITEMAP_ROUTES).toEqual(INDEXABLE_ROUTES);
		// sitemap に載せない直リンクだけのルートが、うっかり sitemap へ混ざっていない
		for (const route of NON_INDEXABLE_DEEP_LINK_ROUTES) {
			expect(SITEMAP_ROUTES).not.toContain(route);
		}
	});
});
