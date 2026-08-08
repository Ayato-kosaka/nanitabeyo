import { test, expect } from "../../fixtures/test";
import { PUBLIC_LOCALES } from "@shared/api/v1/constants/publicLocales";

/**
 * 🗳 友達投票の共有 URL が「ロケール別の静的 OGP」を返すこと @smoke
 *
 * ## 背景（実機で踏んだ）
 * 投票の共有 URL は `/{locale}/search/dish-category-group-votes/{token}/vote` で、
 * `[shareToken]` が動的セグメントのため **expo export は prerender できない**。
 * rewrite が無いと catch-all（`** -> /index.html`）に落ち、ロケールを持たない
 * ルートの index.html が返る。その結果、LINE 等へ貼っても
 * **タイトルが出ず OG 画像も別物**になっていた。
 *
 * ## なぜ config テストだけでは足りないのか
 * `tests/config/firebase-rewrites.spec.ts` は firebase.json と dist の整合しか見ない。
 * **rewrite が実際に効いているか**は、デプロイ済みのホスティングを叩かないと分からない
 * （#281 / #721 で「設定は正しいのに配信されているものが違う」を 2 回踏んでいる）。
 * このファイルは `@smoke` なので、`firebase-hosting-deploy.yml` が
 * **デプロイ直後の実 URL に対して**実行する。
 *
 * ## page ではなく request で取る理由
 * OGP を読むのは SNS のクローラで、**JS を実行しない**。ブラウザで開いて
 * `document.title` を見ると SPA が書き換えた後の値を見てしまい、
 * 「クローラに何が見えるか」の検証にならない。初回 HTML をそのまま見る。
 */

/** 実在しないトークン。rewrite が効いていれば、存在有無に関わらず同じ HTML が返る */
const ANY_TOKEN = "e2e-smoke-vote-token";

const metaContent = (html: string, property: string): string | null => {
	const patterns = [
		new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`, "i"),
		new RegExp(`<meta\\s+content="([^"]*)"\\s+property="${property}"`, "i"),
	];
	for (const re of patterns) {
		const m = html.match(re);
		if (m) return m[1];
	}
	return null;
};

const titleOf = (html: string): string | null => {
	const m = html.match(/<title>([\s\S]*?)<\/title>/i);
	return m ? m[1].trim() : null;
};

test.describe("友達投票の共有 URL の静的 OGP @smoke", () => {
	// ─ テストケース: JS 無しでも title と og:image が入っている ─
	// 手順:
	//   1. 投票 URL の初回 HTML を request で取る（JS を実行しない＝クローラと同じ見え方）
	//   2. title が空でないこと、og:image があることを検証
	//
	// catch-all に落ちているとルートの index.html が返り、ここが空になる
	test("投票 URL の初回 HTML に title と og:image が入っている", async ({ request, baseURL }) => {
		const response = await request.get(`${baseURL}/ja-JP/search/dish-category-group-votes/${ANY_TOKEN}/vote`);

		expect(response.status(), "投票 URL が 200 で返ること").toBe(200);

		const html = await response.text();
		expect(titleOf(html), "title が空（catch-all の index.html に落ちている疑い）").toBeTruthy();
		expect(metaContent(html, "og:image"), "og:image が無い").toBeTruthy();
		expect(metaContent(html, "og:title"), "og:title が無い").toBeTruthy();
	});

	// ─ テストケース: ロケールごとに «そのロケールの» OGP が返る ─
	// 手順:
	//   1. 全 PUBLIC_LOCALES の投票 URL を取る
	//   2. og:locale が URL のロケールと一致することを検証
	//
	// ⚠️ ここが本題。rewrite は destination で `:param` を展開できないため
	// **ロケールごとに手で 8 本並べている**。ja-JP の URL が en-US の HTML を返す
	// 取り違えは、設定を目で見ても気付きにくい
	test("ロケールごとに そのロケールの OGP が返る", async ({ request, baseURL }) => {
		const mismatched: string[] = [];

		for (const locale of PUBLIC_LOCALES) {
			const response = await request.get(`${baseURL}/${locale}/search/dish-category-group-votes/${ANY_TOKEN}/vote`);
			expect(response.status(), `${locale} の投票 URL が 200 で返ること`).toBe(200);

			const html = await response.text();
			const ogLocale = metaContent(html, "og:locale");
			// og:locale は `ja_JP` 形式（BCP 47 のハイフンではなくアンダースコア）
			const expected = locale.replace("-", "_");
			if (ogLocale !== expected) mismatched.push(`${locale}: og:locale=${ogLocale}（期待 ${expected}）`);
		}

		expect(mismatched, "URL のロケールと og:locale が食い違う（rewrite の destination の取り違え）").toEqual([]);
	});
});
