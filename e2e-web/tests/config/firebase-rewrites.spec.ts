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

test.describe("firebase.json rewrite 整合性", () => {
	// ─ テストケース: 全 rewrite の destination が dist に実在する ─
	// 手順:
	//   1. firebase.json から本番サイト(app-nanitabeyo-net)の rewrites を読み込む
	//   2. 各 destination(SPA fallback の /index.html 含む)が
	//      app-expo/dist 配下に実ファイルとして存在することを検証
	test("全 rewrite の destination が dist に実在する", async () => {
		const firebaseConfig = JSON.parse(fs.readFileSync(FIREBASE_JSON_PATH, "utf-8")) as {
			hosting: Array<{ site?: string; rewrites?: Array<{ source: string; destination: string }> }>;
		};

		const site = firebaseConfig.hosting.find((h) => h.site === "app-nanitabeyo-net");
		expect(site, "firebase.json に site: app-nanitabeyo-net が存在すること").toBeTruthy();
		expect(site!.rewrites?.length, "rewrites が定義されていること").toBeGreaterThan(0);

		const missing = site!
			.rewrites!.filter((rewrite) => !fs.existsSync(path.join(DIST_DIR, rewrite.destination.replace(/^\//, ""))))
			.map((rewrite) => `${rewrite.source} -> ${rewrite.destination}`);

		expect(
			missing,
			"dist に存在しない destination を指す rewrite(本番で 404 になる)。firebase.json を dist の実構造に合わせて修正すること",
		).toEqual([]);
	});
});
