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

/** 本番ドメインを配信するサイト（`food-scroll` は 301 リダイレクト専用なので対象外） */
const appSite = firebaseConfig.hosting.find((h) => h.site === "app-nanitabeyo-net");

describe("#721 firebase.json の /s/** rewrite", () => {
	it("app-nanitabeyo-net サイトに設定されている", () => {
		// food-scroll 側へ足しても意味がない（あちらは 301 で app.nanitabeyo.net へ飛ばすだけ）
		expect(appSite).toBeDefined();
		expect(appSite?.rewrites).toBeDefined();
	});

	it("catch-all より前に置かれている", () => {
		const rewrites = appSite?.rewrites ?? [];
		const shareIndex = rewrites.findIndex((r) => r.source === `/${SHARE_LINK_PATH_PREFIX}/**`);
		const catchAllIndex = rewrites.findIndex((r) => r.source === "**");

		expect(shareIndex).toBeGreaterThanOrEqual(0);
		expect(catchAllIndex).toBeGreaterThanOrEqual(0);
		// ここが逆転すると /s/<token> は index.html を 200 で返す（#281 と同型）
		expect(shareIndex).toBeLessThan(catchAllIndex);
	});

	it("Cloud Run へ向いている（静的ファイルへの destination ではない）", () => {
		const shareRewrite = (appSite?.rewrites ?? []).find(
			(r) => r.source === `/${SHARE_LINK_PATH_PREFIX}/**`,
		);

		expect(shareRewrite?.run?.serviceId).toBe("api-production");
		expect(shareRewrite?.run?.region).toBeTruthy();
		expect(shareRewrite?.destination).toBeUndefined();
	});

	it("rewrite に Firebase が知らないキーを混ぜない", () => {
		// JSON にコメントは書けない。説明のつもりで `"//"` のようなキーを足すと
		// firebase deploy の設定検証で落ちうるので、許すキーを固定しておく
		//（経緯と設計は docs/share-links.md に書く）
		const shareRewrite = (appSite?.rewrites ?? []).find(
			(r) => r.source === `/${SHARE_LINK_PATH_PREFIX}/**`,
		);

		expect(Object.keys(shareRewrite ?? {}).sort()).toEqual(["run", "source"]);
	});
});
