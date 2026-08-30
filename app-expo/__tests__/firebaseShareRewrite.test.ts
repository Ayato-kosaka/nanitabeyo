import { readFileSync } from "node:fs";
import path from "node:path";

import { SHARE_LINK_PATH_PREFIX } from "@shared/api/v1/constants/shareLinks";

/**
 * 🔥 `firebase.json` の rewrite 順序（#721）。
 *
 * ## なぜテストするのか
 * Firebase Hosting の rewrite は **先勝ち**。`/s/**` を catch-all（`"**" → /index.html`）より
 * 後ろに置くと、`/s/<token>` に **index.html が 200 で返る**。
 *
 * #281 で `/sitemap.xml` がまさにこれで壊れていた。404 ではなく **200 が返る**ので、
 * 監視でもスモークでも気づけない（「ページは開くが OGP が既定のまま」に見える）。
 *
 * rewrite の追加は「動いているように見える」変更なので、順序だけを機械的に固定する。
 */
const firebaseConfig = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "firebase.json"), "utf8")) as {
	hosting: Array<{
		site: string;
		rewrites?: Array<{ source: string; destination?: string; run?: { serviceId: string; region: string } }>;
	}>;
};

const siteOf = (site: string) => firebaseConfig.hosting.find((h) => h.site === site);
const shareRewriteOf = (site: string) =>
	(siteOf(site)?.rewrites ?? []).find((r) => r.source === `/${SHARE_LINK_PATH_PREFIX}/**`);

/**
 * 共有リンクを配信する 2 サイト。
 *
 * `food-scroll` は本番へ 301 リダイレクトするだけ、`oia-relay` は別オリジンの
 * リダイレクタなので、どちらも `/s/**` を持たない。
 */
const SHARE_SITES = [
	{ site: "app-nanitabeyo-net", serviceId: "api-production" },
	// #721 dev サイトは **api-development** を向く。ここが api-production だと、
	// 開発環境で作った共有リンクが本番 API へ飛んで必ず 404 になる
	{ site: "nanitabeyo-dev", serviceId: "api-development" },
] as const;

describe("#721 firebase.json の /s/** rewrite", () => {
	describe.each(SHARE_SITES)("$site", ({ site, serviceId }) => {
		it("サイトが定義されている", () => {
			expect(siteOf(site)).toBeDefined();
			expect(siteOf(site)?.rewrites).toBeDefined();
		});

		it("catch-all より前に置かれている", () => {
			const rewrites = siteOf(site)?.rewrites ?? [];
			const shareIndex = rewrites.findIndex((r) => r.source === `/${SHARE_LINK_PATH_PREFIX}/**`);
			const catchAllIndex = rewrites.findIndex((r) => r.source === "**");

			expect(shareIndex).toBeGreaterThanOrEqual(0);
			expect(catchAllIndex).toBeGreaterThanOrEqual(0);
			// ここが逆転すると /s/<token> は index.html を 200 で返す（#281 と同型）
			expect(shareIndex).toBeLessThan(catchAllIndex);
		});

		it(`Cloud Run の ${serviceId} へ向いている`, () => {
			const shareRewrite = shareRewriteOf(site);

			expect(shareRewrite?.run?.serviceId).toBe(serviceId);
			expect(shareRewrite?.run?.region).toBeTruthy();
			expect(shareRewrite?.destination).toBeUndefined();
		});

		it("rewrite に Firebase が知らないキーを混ぜない", () => {
			// JSON にコメントは書けない。説明のつもりで `"//"` のようなキーを足すと
			// firebase deploy の設定検証で落ちうるので、許すキーを固定しておく
			//（経緯と設計は docs/specs/share-links.md に書く）
			expect(Object.keys(shareRewriteOf(site) ?? {}).sort()).toEqual(["run", "source"]);
		});
	});

	// ⚠️ 2 サイトが同じ serviceId を向いていたら、片方は必ず間違っている。
	// コピペで dev サイトを作ったときに一番起きやすい事故なので、明示的に見る
	it("本番サイトと dev サイトが別の Cloud Run サービスを向いている", () => {
		expect(shareRewriteOf("app-nanitabeyo-net")?.run?.serviceId).not.toBe(
			shareRewriteOf("nanitabeyo-dev")?.run?.serviceId,
		);
	});

	it("リダイレクト専用サイトには /s/** を置かない", () => {
		// food-scroll は 301 で app.nanitabeyo.net へ飛ばすだけ。ここに置いても効かない
		expect(shareRewriteOf("food-scroll")).toBeUndefined();
		expect(shareRewriteOf("oia-relay")).toBeUndefined();
	});
});
