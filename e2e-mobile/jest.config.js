/**
 * 🃏 Detox + Jest ランナー設定
 *
 * ## テスト 3 層構造（e2e-web と同一の考え方）
 * - Tier 1 `@smoke`   : tests/smoke/                              起動・タブ導線の最小確認
 * - Tier 2 (無タグ)   : tests/navigation|search|review|profile|authenticated/
 * - Tier 3 `@mutation`: tests/mutation/                           dev DB へ書き込む。**既定では読み込まれない**
 *
 * ## Tier の絞り込み方法（Playwright の --grep 相当）
 * - Tier 1 のみ : `pnpm test:smoke:android`      (= `-- --testPathPattern 'tests/smoke/'`)
 * - Tier 1+2    : `pnpm test:android`            (testPathIgnorePatterns が Tier 3 を弾く)
 * - Tier 3 のみ : `pnpm test:mutation:android`   (RUN_MUTATION=1 + --testPathPattern 'tests/mutation/')
 * - 全件        : `pnpm test:all:android`
 *
 * `detox test` の `--` 以降の引数はそのまま Jest へ転送される（Detox CLI の仕様）。
 */

// #1028 【設計】§6-1: Tier 3(@mutation) の主防御。RUN_MUTATION が無い限り tests/mutation/ を
// **テスト探索の対象から外す**。テスト名フィルタ（--testNamePattern）ではなくパス除外にすることで、
// 「ファイルがロードされること自体」を防ぎ、フィルタ漏れ時に fail-open しないようにしている
// （e2e-web の playwright.config.ts の grepInvert に対応する位置づけ）。
// #1030 【設計】レビュー M-3: これに加えて fixtures/e2e.ts の describeMutation がコード段でも塞ぐ（二重ガード）。
const isMutationEnabled = process.env.RUN_MUTATION === "1";

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	rootDir: ".",
	testMatch: ["<rootDir>/tests/**/*.test.ts"],
	// 既定値（node_modules の除外）を失わないよう、除外パターンは必ず一緒に列挙する
	testPathIgnorePatterns: isMutationEnabled ? ["/node_modules/"] : ["/node_modules/", "<rootDir>/tests/mutation/"],

	// #1027 【設計】E2E は実機相当の起動・ネットワークを待つため単体テストより大幅に長くする
	testTimeout: 300000,
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
};
