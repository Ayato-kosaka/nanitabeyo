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
 * ## ⚠️ このファイルは «実ホスティング» でしか意味がない
 * 検証しているのは **Firebase Hosting の rewrite が効いているか**である。
 * `e2e-web-test.yml` は `scripts/serve-dist.mjs` で dist をローカル配信するため
 * **rewrite が存在せず、必ず落ちる**（実際に 1 度落とした）。
 * localhost が相手のときは skip し、`firebase-hosting-deploy.yml` の
 * デプロイ後スモークでだけ走らせる。
 *
 * 「firebase.json の設定が正しいか」と「宛先ファイルに OGP があるか」は
 * `tests/config/firebase-rewrites.spec.ts` が dist を直接読んで別途守っている。
 * 3 つを分けているのは、落ちたときに **どこが原因か即断できるようにする**ため。
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
	// ローカルの dist 配信には rewrite が無い。ここで skip しないと必ず赤くなる
	test.skip(
		({ baseURL }) => !baseURL || /localhost|127\.0\.0\.1/.test(baseURL),
		"Firebase Hosting の rewrite を見るテストなので、ローカル配信では実行しない",
	);

	// ─ テストケース: rewrite が効いているか（原因切り分け用のプローブ付き）─
	// 手順:
	//   1. 対照（/{locale}/search）と対象（投票 URL）の初回 HTML を取る
	//   2. 対照に og:locale があることを確認（＝ 宛先ページ自体は正しい）
	//   3. 対象にも同じ og:locale が入っていることを検証
	//
	// 失敗時は両方の実測値を出す。対照が OK で対象が NG なら rewrite 側、
	// 両方 NG なら宛先ページの選び方が誤り、と即断できる
	test("投票 URL が対照ページと同じ OGP を返す", async ({ request, baseURL }) => {
		const control = await request.get(`${baseURL}/ja-JP/search`);
		const controlHtml = await control.text();
		const controlLocale = metaContent(controlHtml, "og:locale");

		const target = await request.get(`${baseURL}/ja-JP/search/dish-category-group-votes/${ANY_TOKEN}/vote`);
		const targetHtml = await target.text();
		const targetLocale = metaContent(targetHtml, "og:locale");

		// 対照が壊れていたら、そもそも宛先の選び方が誤っている
		expect(
			controlLocale,
			`対照 /ja-JP/search に og:locale が無い（status=${control.status()} / title=${titleOf(controlHtml)}）`,
		).toBe("ja_JP");

		expect(
			targetLocale,
			`投票 URL の og:locale が対照と違う。status=${target.status()} / title=${titleOf(targetHtml)} / ` +
				`og:title=${metaContent(targetHtml, "og:title")} — rewrite が効かず catch-all の index.html に落ちている疑い`,
		).toBe("ja_JP");

		expect(titleOf(targetHtml), "投票 URL の title が空").toBeTruthy();
		expect(metaContent(targetHtml, "og:image"), "投票 URL の og:image が無い").toBeTruthy();
	});

	// ─ テストケース: ロケールごとに «そのロケールの» OGP が返る ─
	//
	// ⚠️ rewrite は destination で `:param` を展開できないため **ロケールごとに
	// 手で 8 本並べている**。ja-JP の URL が en-US の HTML を返す取り違えは、
	// 設定を目で見ても気付きにくい
	test("ロケールごとに そのロケールの OGP が返る", async ({ request, baseURL }) => {
		const mismatched: string[] = [];

		for (const locale of PUBLIC_LOCALES) {
			const response = await request.get(`${baseURL}/${locale}/search/dish-category-group-votes/${ANY_TOKEN}/vote`);
			const html = await response.text();
			const ogLocale = metaContent(html, "og:locale");
			// og:locale は `ja_JP` 形式（BCP 47 のハイフンではなくアンダースコア）
			const expected = locale.replace("-", "_");
			if (ogLocale !== expected) {
				// ⚠️ 何が返っているのかを message に出すこと。status と og:locale だけだと
				// 「rewrite が効いていない」のか「別のページが返っている」のかを切り分けられず、
				// 実際に 3 往復した
				mismatched.push(
					`${locale}: status=${response.status()} og:locale=${ogLocale} title=${JSON.stringify(titleOf(html))} ` +
						`canonical=${JSON.stringify(metaContent(html, "og:url"))}（期待 ${expected}）`,
				);
			}
		}

		expect(mismatched, "URL のロケールと og:locale が食い違う（rewrite の destination の取り違え）").toEqual([]);
	});
});
