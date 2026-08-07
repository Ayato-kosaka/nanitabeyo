import * as fs from "node:fs";
import * as path from "node:path";
// 注: このテストはブラウザを一切使わない Node 単体の検証のため、例外的に
// fixtures/test ではなく @playwright/test を直接 import する
// (fixtures/test の consoleErrors は auto フィクスチャで page に依存しており、
//  経由するとテストごとに不要なブラウザページが起動してしまう)
import { test, expect } from "@playwright/test";

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
				.filter((rewrite) => !fs.existsSync(path.join(DIST_DIR, rewrite.destination!.replace(/^\//, ""))))
				.map((rewrite) => `${rewrite.source} -> ${rewrite.destination}`);

			expect(
				missing,
				"dist に存在しない destination を指す rewrite(本番で 404 になる)。firebase.json を dist の実構造に合わせて修正すること",
			).toEqual([]);
		});
	}

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
