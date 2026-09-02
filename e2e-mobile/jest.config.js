/**
 * 🃏 Detox + Jest ランナー設定
 *
 * ## テスト 3 層構造（e2e-web と同一の考え方）
 * - Tier 1 `@smoke`   : tests/smoke/                              起動・タブ導線の最小確認
 * - Tier 2 (無タグ)   : tests/navigation|search|my-dishes|dish-category-group-votes|profile|authenticated/
 * - Tier 3 `@mutation`: tests/mutation/                           dev DB へ書き込む。**既定では読み込まれない**
 * - 番外  `@probe`    : tests/probe/                              「修正が入るまで落ちるのが正しい」spec 置き場。
 *                                                                **既定では読み込まれない / 現在は空**
 *
 * ## Tier の絞り込み方法（Playwright の --grep 相当）
 * - Tier 1 のみ : `pnpm test:smoke:android`      (= `-- --testPathPattern 'tests/smoke/'`)
 * - Tier 1+2    : `pnpm test:android`            (testPathIgnorePatterns が Tier 3 と @probe を弾く)
 * - Tier 3 のみ : `pnpm test:mutation:android`   (RUN_MUTATION=1 + --testPathPattern 'tests/mutation/')
 * - @probe のみ : `pnpm test:probe:android`      (RUN_PROBE=1 + --testPathPattern 'tests/probe/')
 * - 全件        : `pnpm test:all:android`        (@probe は含まない。上記で明示実行すること)
 *
 * `detox test` の `--` 以降の引数はそのまま Jest へ転送される（Detox CLI の仕様）。
 */

// #1028 【設計】§6-1: Tier 3(@mutation) の主防御。RUN_MUTATION が無い限り tests/mutation/ を
// **テスト探索の対象から外す**。テスト名フィルタ（--testNamePattern）ではなくパス除外にすることで、
// 「ファイルがロードされること自体」を防ぎ、フィルタ漏れ時に fail-open しないようにしている
// （e2e-web の playwright.config.ts の grepInvert に対応する位置づけ）。
// #1030 【設計】レビュー M-3: これに加えて fixtures/e2e.ts の describeMutation がコード段でも塞ぐ（二重ガード）。
const isMutationEnabled = process.env.RUN_MUTATION === "1";

// #1087 【設計】@probe（tests/probe/）も同じ方式で既定の探索から外す。こちらの理由は安全性ではなく
// **「修正が入るまで落ちるのが正しい spec」だから**。アプリの不具合を数値で示すことが目的なので、
// 夜間 CI の既定スコープ（tier1-2）へ混ぜると常時赤くなり、本物の回帰が埋もれる。
// 二重ガードの片割れは fixtures/e2e.ts の describeProbe（--testPathPattern でのバイパス対策）。
// ⚠️ この層は現在意図的に空（先読み画像プローブは修正完了に伴い tests/search/ へ昇格した）。
//    仕組みだけを次の「落ちるのが正しい spec」のために残している（README.md 参照）。
const isProbeEnabled = process.env.RUN_PROBE === "1";

// #UIカタログ 【設計】tests/catalog/ は「検証」ではなく「全画面のスクリーンショット収集」で、
// 実行にも時間がかかる。@mutation / @probe と同じ方式で既定の探索から外し、
// RUN_CATALOG=1（= pnpm test:catalog:*）のときだけ読み込む
const isCatalogEnabled = process.env.RUN_CATALOG === "1";

/** 既定値（node_modules の除外）を失わないよう、除外パターンは必ず一緒に列挙する */
const testPathIgnorePatterns = ["/node_modules/"];
if (!isMutationEnabled) testPathIgnorePatterns.push("<rootDir>/tests/mutation/");
if (!isProbeEnabled) testPathIgnorePatterns.push("<rootDir>/tests/probe/");
if (!isCatalogEnabled) testPathIgnorePatterns.push("<rootDir>/tests/catalog/");

// 🔬 spec の絞り込み（workflow_dispatch の test_filter → DETOX_RECORD 系と同じく env で届く）。
//
// ⚠️ jest の位置引数や --testPathPattern で渡してはいけない。それらは jest 内部で
// **すべて 1 つの OR リストへ合流する**ため、tier スクリプトが持つ
// `--testPathPattern 'tests/smoke/'` と併用すると「(smoke) OR (filter)」になり、
// 絞ったつもりで全 smoke が実行されていた（run 32605810775 で実測: iOS のテストが 14.9 分）。
// testPathIgnorePatterns は選択とは独立に AND で効くため、
// 「filter のどの語も含まないパスを除外する」否定先読みで (tier) AND (filter) を表現する。
const testFilter = (process.env.DETOX_TEST_FILTER || "").trim();
if (testFilter) {
	const words = testFilter
		.split(/[|\s]+/)
		.filter(Boolean)
		.map((word) => word.replace(/[.*+?^${}()[\]\\]/g, "\\$&"));
	if (words.length > 0) testPathIgnorePatterns.push(`^(?!.*(?:${words.join("|")}))`);
}

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	rootDir: ".",
	testMatch: ["<rootDir>/tests/**/*.test.ts"],
	testPathIgnorePatterns,

	// #1027 【設計】E2E は実機相当の起動・ネットワークを待つため単体テストより大幅に長くする。
	// この値は **フック（beforeAll/beforeEach）にも効く**。run 30445542854 では最初に走った suite の
	// beforeAll が 300 秒を超えた（エミュレータが冷えている状態での APK インストール + 初回起動）。
	// 同じ suite はリトライでは 23 秒で通っており、恒常的な遅さではなく初回だけのコスト。
	// 上限を上げても通過時の実行時間には影響しないため、余裕を取る
	testTimeout: 600000,
	// #1027 【設計】1 台のエミュレータを全テストで共有するため並列化しない
	// #1030 【設計】レビュー 3.1: 並列化すると同一 refresh token を複数プロセスが同時に使うことになり、
	// Supabase の reuse 検知でセッションファミリごと失効しうる。**maxWorkers: 1 が前提**
	maxWorkers: 1,

	// ── Detox 連携の必須設定（Detox Internals API との接続点） ────────────────
	// #1030 【設計】レビュー M-6: globalSetup / globalTeardown は Detox 公式実装を **置き換えず**、
	// fixtures/ 側で import してラップしている（セッションの事前確立と revoke を足すため）。
	// testEnvironment / reporter は公式実装をそのまま使う
	globalSetup: "<rootDir>/fixtures/globalSetup.ts",
	globalTeardown: "<rootDir>/fixtures/globalTeardown.ts",
	reporters: ["detox/runners/jest/reporter"],
	testEnvironment: "detox/runners/jest/testEnvironment",

	verbose: true,
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
	},

	// #1503 直リンクスモークが app-expo の公開ルート一覧（lib/seo/publicRoutes.ts）を import する。
	// tsconfig の paths は **型解決にしか効かない**ので、実行時の解決はここで対応させる。
	// 参照先は react / expo / detox に依存しない純粋な TS に限ること（ts-jest がそのまま変換する）。
	moduleNameMapper: {
		"^@app-expo/(.*)$": "<rootDir>/../app-expo/$1",
	},
};
