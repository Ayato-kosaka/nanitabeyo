import * as fs from "node:fs";
import * as path from "node:path";
// 注: このテストはブラウザを一切使わない Node 単体の検証のため、例外的に
// fixtures/test ではなく @playwright/test を直接 import する
// (fixtures/test の consoleErrors は auto フィクスチャで page に依存しており、
//  経由するとテストごとに不要なブラウザページが起動してしまう)
import { test, expect } from "@playwright/test";
import { PUBLIC_LOCALES } from "@shared/api/v1/constants/publicLocales";
import { metaContent } from "../../utils/htmlMeta";

/**
 * 🔥 firebase.json rewrite 設定と dist 出力の整合性テスト
 *
 * ## 背景(実際に起きた本番バグ)
 * expo export は「子ルートを持つ画面」をディレクトリ + index.html
 * (例: [locale]/search/index.html)として出力するが、firebase.json の rewrite が
 * 古い単一ファイル形式(/[locale]/search.html)を指したままになっており、
 * 本番 https://app.nanitabeyo.net/ja-JP/search 等の主要タブへの直リンク/リロードが
 * 404 になっていた(search / profile / review / notifications の 4 タブが該当)。
 *
 * ローカルの静的サーバ(scripts/serve-dist.mjs)は X.html と X/index.html の両方を
 * 解決する寛容な実装のため、この設定ミスは E2E のディープリンクテストでは検知できない。
 * Firebase Emulator を使えば完全に再現できるが重いので、代わりにこのテストで
 * 「rewrite の destination が dist に実在するか」という設定と成果物の整合性だけを
 * 静的に検証する(ブラウザ不要・数十 ms で完了)。
 *
 * ## 失敗した場合
 * expo-router のルート構成変更(子ルートの追加/削除)により dist の出力形式が
 * 変わった可能性が高い。firebase.json の該当 rewrite の destination を
 * 実際の dist の構造に合わせて更新すること。
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIREBASE_JSON_PATH = path.join(REPO_ROOT, "firebase.json");
const DIST_DIR = path.join(REPO_ROOT, "app-expo/dist");

/** firebase.json の rewrite。`destination`（静的ファイル）と `run`（Cloud Run）は排他 */
type Rewrite = {
	source: string;
	destination?: string;
	run?: { serviceId?: string; region?: string };
};

/** 静的アセットを配信するサイト（dist を public に持つもの） */
const DIST_SITES = ["app-nanitabeyo-net", "nanitabeyo-dev"] as const;

/**
 * 投票 URL の rewrite が指すべき宛先。
 *
 * `[shareToken]` は **リテラルのディレクトリ名**。expo export は動的セグメントを
 * 角括弧付きのまま書き出すので、これで実ファイルに当たる（`dist` を見れば確認できる）。
 */
const VOTE_DESTINATION = (locale: string) => `/${locale}/search/dish-category-group-votes/[shareToken]/vote.html`;

/**
 * destination が dist の «何か» に解決できるか。
 *
 * ⚠️ **ファイルの存在だけを見ないこと。** この設定は `cleanUrls: true` なので、
 * Firebase Hosting は `X/index.html` を URL `X` として配信する。したがって
 * destination には `/ja-JP/search`（拡張子なし）も正当に書ける。
 * 素朴に `existsSync(destination)` だけを見ると、正しい設定を弾いてしまう。
 *
 * @returns 実体のパス。解決できなければ null
 */
function resolveDestination(destination: string): string | null {
	const base = path.join(DIST_DIR, destination.replace(/^\//, ""));
	for (const candidate of [base, path.join(base, "index.html"), `${base}.html`]) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
	}
	return null;
}

const readHosting = (): Array<{ site?: string; rewrites?: Rewrite[] }> =>
	(
		JSON.parse(fs.readFileSync(FIREBASE_JSON_PATH, "utf-8")) as {
			hosting: Array<{ site?: string; rewrites?: Rewrite[] }>;
		}
	).hosting;

test.describe("firebase.json rewrite 整合性", () => {
	// ─ テストケース: 全 rewrite の destination が dist に実在する ─
	// 手順:
	//   1. firebase.json から dist を配信するサイトの rewrites を読み込む
	//   2. 各 destination(SPA fallback の /index.html 含む)が
	//      app-expo/dist 配下に実ファイルとして存在することを検証
	//
	// ⚠️ `destination` を持たない rewrite（Cloud Run へのプロキシ）は対象外。
	// #721 で `/s/** -> run` を足したとき、ここが `rewrite.destination.replace(...)` で
	// **TypeError を投げて落ちた**。「dist にファイルがあるか」という検査は
	// 静的ファイルへの rewrite にしか意味がないので、種類で分けて扱う。
	for (const siteName of DIST_SITES) {
		test(`${siteName}: 全 rewrite の destination が dist に実在する`, async () => {
			const site = readHosting().find((h) => h.site === siteName);
			expect(site, `firebase.json に site: ${siteName} が存在すること`).toBeTruthy();
			expect(site!.rewrites?.length, "rewrites が定義されていること").toBeGreaterThan(0);

			const missing = site!
				.rewrites!.filter((rewrite) => rewrite.destination !== undefined)
				.filter((rewrite) => resolveDestination(rewrite.destination!) === null)
				.map((rewrite) => `${rewrite.source} -> ${rewrite.destination}`);

			expect(
				missing,
				"dist に存在しない destination を指す rewrite(本番で 404 になる)。firebase.json を dist の実構造に合わせて修正すること",
			).toEqual([]);
		});
	}

	// ─ テストケース: 友達投票の共有 URL がロケール別の静的 OGP を持つ ─
	// 手順:
	//   1. dist を配信する各サイトの rewrites を読む
	//   2. `PUBLIC_LOCALES` すべてに投票 URL の rewrite があることを検証
	//   3. その destination が **同じロケールの** ページであることを検証
	//
	// ## 背景（実機で踏んだ）
	// 投票の共有 URL は `/{locale}/search/dish-category-group-votes/{token}/vote` で、
	// `[shareToken]` が動的セグメントのため **expo export は prerender できない**。
	// rewrite が無いと catch-all（`** -> /index.html`）に落ち、ロケールを持たない
	// ルートの index.html が返る。その結果、LINE 等へ貼っても
	// **タイトルが出ず OG 画像も別物**になる（実機フィードバック）。
	//
	// ⚠️ **ロケールを取り違えないこと。** Firebase Hosting の rewrite は
	// destination で `:param` を展開できないため、ロケールごとに 1 本ずつ書く必要がある。
	// 手で 8 本並べる以上、ja-JP の URL が en-US の HTML を返す事故が起こりうるので、
	// 「source と destination のロケールが一致する」ところまで機械的に見る。
	for (const siteName of DIST_SITES) {
		test(`${siteName}: 友達投票の共有 URL が全ロケールでロケール別 HTML を返す`, async () => {
			const site = readHosting().find((h) => h.site === siteName);
			const rewrites = site!.rewrites ?? [];

			const missing: string[] = [];
			const mismatched: string[] = [];
			for (const locale of PUBLIC_LOCALES) {
				const source = `/${locale}/search/dish-category-group-votes/**`;
				const rewrite = rewrites.find((r) => r.source === source);
				if (!rewrite) {
					missing.push(source);
					continue;
				}
				// ⚠️ **clean URL（拡張子なし）では 404 になる。** 実測: destination を
				// `/ja-JP/search` にしたら全ロケール 404（run 31264845849）。
				// Firebase の rewrite destination は «実ファイルのパス» で書く必要がある。
				//
				// ⚠️ **宛先は検索画面ではなく «投票画面の prerender»。** 検索画面を指していたときは
				// ロケールは合っていても文言がアプリ紹介文のままで、LINE に貼っても
				// 「友達投票への招待」だと分からなかった（実機フィードバック）。
				// `[shareToken]` はディレクトリ名にそのまま出る（expo export が動的セグメントを
				// リテラルで書き出すため）。角括弧付きで «正しい»
				if (rewrite.destination !== VOTE_DESTINATION(locale)) {
					mismatched.push(`${source} -> ${rewrite.destination}（期待 ${VOTE_DESTINATION(locale)}）`);
				}
			}

			expect(missing, "投票 URL の rewrite が無いロケール（catch-all に落ちて OGP が壊れる）").toEqual([]);
			expect(mismatched, "source と destination のロケールが食い違っている rewrite").toEqual([]);

			// catch-all より前に無いと意味がない（後ろだと ** に食われる）
			const catchAllIndex = rewrites.findIndex((r) => r.source === "**");
			const lastVoteIndex = rewrites.reduce(
				(acc, r, i) => (r.source.includes("dish-category-group-votes") ? i : acc),
				-1,
			);
			expect(lastVoteIndex, "投票 URL の rewrite が見つからない").toBeGreaterThanOrEqual(0);
			expect(lastVoteIndex, "投票 URL の rewrite が catch-all より後ろにある").toBeLessThan(catchAllIndex);
		});
	}

	// ─ テストケース: 投票 rewrite の宛先ファイルが «実際に» OGP を持っているか ─
	//
	// ## なぜ「存在する」だけでは足りないか
	// 上の検査は destination が dist に実在するかしか見ていない。実 URL に対する
	// スモーク（`tests/smoke/vote-share-ogp.spec.ts`）で og:locale が全ロケール null
	// になったとき、原因が «rewrite が効いていない» のか «宛先ファイルに OGP が無い» のか
	// を切り分けられなかった。ここは **ファイルの中身**を見るので前者を排除できる。
	//
	// ## ⚠️ 抽出は必ず `utils/htmlMeta.ts` を使うこと（ここが本題）
	// かつてこの検査は自前の緩い正規表現、スモークは自前の厳しい正規表現を持っていた。
	// expo export の実際の出力は `<meta data-rh="true" property="og:locale" ...>` で、
	// スモーク側だけが **一度も一致しない**状態だったため、
	// 「ファイルには OGP がある / レスポンスには無い」という嘘の食い違いが生まれ、
	// 無実の rewrite を 3 回書き換えた。共有の抽出器を **実ファイル相手に**通しておけば、
	// 抽出器が厳しすぎる退行はデプロイ前のこのオフライン検査で落ちる。
	test("投票 rewrite の宛先ファイルに og:locale が入っている", async () => {
		const site = readHosting().find((h) => h.site === "app-nanitabeyo-net");
		const problems: string[] = [];

		for (const locale of PUBLIC_LOCALES) {
			const rewrite = (site!.rewrites ?? []).find((r) => r.source === `/${locale}/search/dish-category-group-votes/**`);
			if (!rewrite?.destination) {
				problems.push(`${locale}: rewrite が無い`);
				continue;
			}
			const file = resolveDestination(rewrite.destination);
			if (!file) {
				problems.push(`${locale}: ${rewrite.destination} が dist に解決できない`);
				continue;
			}
			const html = fs.readFileSync(file, "utf-8");
			const ogLocale = metaContent(html, "og:locale");
			const expected = locale.replace("-", "_");
			if (ogLocale === null) problems.push(`${locale}: ${rewrite.destination} に og:locale が無い`);
			else if (ogLocale !== expected) problems.push(`${locale}: og:locale=${ogLocale}（期待 ${expected}）`);

			// スモークが実 URL に対して掛けるのと同じアサーションを、宛先ファイルへ先に掛ける。
			// ここが緑なら「スモークが落ちたら原因は Hosting 側」と断定できる
			if (!metaContent(html, "og:title")) problems.push(`${locale}: ${rewrite.destination} に og:title が無い`);
			if (!metaContent(html, "og:image")) problems.push(`${locale}: ${rewrite.destination} に og:image が無い`);
		}

		expect(problems, "投票 rewrite の宛先ファイルの OGP").toEqual([]);
	});

	// ─ テストケース: 投票カードの文言が «アプリ紹介» のままになっていないか ─
	//
	// ## 背景（実機フィードバック）
	// rewrite が効いて OGP は出るようになったが、宛先が検索画面だったため
	// タイトルが「なに食べよ ~食べたい料理が見つかる～」というアプリ紹介文で、
	// 受け取った側は **友達投票への招待だと分からなかった**。
	//
	// ⚠️ 文言そのものはここに複製しない。`app-expo/constants/seoLocales.ts` を直したときに
	// テストも書き換える羽目になり、「テストが実装をなぞるだけ」になるため。
	// **検索画面と違う文言であること**という構造だけを見る。これは症状の言い換えそのもの。
	test("投票 rewrite の宛先が、検索画面とは別の文言を持っている", () => {
		const site = readHosting().find((h) => h.site === "app-nanitabeyo-net");
		const problems: string[] = [];

		for (const locale of PUBLIC_LOCALES) {
			const voteFile = resolveDestination(VOTE_DESTINATION(locale));
			const searchFile = resolveDestination(`/${locale}/search/index.html`);
			if (!voteFile || !searchFile) {
				problems.push(`${locale}: dist に解決できない（vote=${!!voteFile} search=${!!searchFile}）`);
				continue;
			}

			const voteTitle = metaContent(fs.readFileSync(voteFile, "utf-8"), "og:title");
			const searchTitle = metaContent(fs.readFileSync(searchFile, "utf-8"), "og:title");

			if (!voteTitle) problems.push(`${locale}: 投票ページに og:title が無い`);
			else if (voteTitle === searchTitle) {
				problems.push(`${locale}: 投票ページの og:title がアプリ紹介文のまま（${voteTitle}）`);
			}
		}

		expect(problems, "投票 URL の共有カードが «友達投票» だと分かる文言になっていない").toEqual([]);
	});

	// ─ テストケース: rewrite は destination か run のどちらか一方だけを持つ ─
	// 両方あると Firebase 側の解釈が読めないし、どちらも無い rewrite は設定ミス。
	// #721 で run 形式を導入したので、形の妥当性をここで固定する
	test("各 rewrite は destination か run のどちらか一方を持つ", async () => {
		const invalid: string[] = [];
		for (const site of readHosting()) {
			for (const rewrite of site.rewrites ?? []) {
				const hasDestination = rewrite.destination !== undefined;
				const hasRun = rewrite.run !== undefined;
				if (hasDestination === hasRun) {
					invalid.push(`${site.site}: ${rewrite.source}`);
					continue;
				}
				// Cloud Run へ回すなら serviceId と region が要る（片方でも欠けるとデプロイが落ちる）
				if (hasRun && (!rewrite.run!.serviceId || !rewrite.run!.region)) {
					invalid.push(`${site.site}: ${rewrite.source}（run の serviceId / region が不足）`);
				}
			}
		}
		expect(invalid, "destination と run の指定が不正な rewrite").toEqual([]);
	});
});
