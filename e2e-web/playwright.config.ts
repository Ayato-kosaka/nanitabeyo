import * as path from "node:path";
import * as dotenv from "dotenv";
import { defineConfig, devices } from "@playwright/test";

/**
 * 🎭 Playwright E2E テスト設定
 *
 * ## 設計方針
 * - テスト対象は `expo export --platform web` の静的エクスポート (`app-expo/dist/`)。
 *   本番 (Firebase Hosting) と同一の成果物をローカル静的サーバ (`scripts/serve-dist.mjs`) で配信する。
 * - バックエンドはビルド時に `EXPO_PUBLIC_BACKEND_BASE_URL` で焼き込まれた Cloud Run `api-development` を使用。
 *   つまり「静的ビルド → CORS → Supabase 匿名 JWT → NestJS API」の実環境相当の経路をテストする。
 * - ビルドは webServer に含めない（テスト毎回の再ビルド防止）。事前に `pnpm --filter app-expo build:web` を実行すること。
 *   dist が無い場合は serve-dist.mjs が日本語エラーで案内する。
 *
 * ## テスト 3 層構造（CI との棲み分け）
 * - Tier 1 `@smoke`   : 起動・直リンク・タブ導線の最小確認。全ブラウザで実行（将来の CI PR ゲート候補）
 * - Tier 2 (無タグ)   : 機能テスト全般。desktop-chrome のみ（将来の CI nightly 候補）
 * - Tier 3 `@mutation`: dev DB へ書き込むテスト。既定では実行されず `RUN_MUTATION=1` で明示実行
 */

// e2e-web/.env を読み込む（無ければ無視される。コミット対象は .env.example のみ）
dotenv.config({ path: path.resolve(__dirname, ".env") });

/** ローカル静的サーバのポート。変更する場合は API 側 CORS_ORIGIN にも新しいオリジンを追加すること */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4173);

/**
 * テスト対象のベース URL。
 * `PLAYWRIGHT_BASE_URL` を指定するとローカルサーバを起動せず、その URL（例: デプロイ済み環境）に対してテストする。
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * ハーネス自己検証（`harness` プロジェクト = tests/harness/）だけを回すモード。
 *
 * このプロジェクトのテストは `page.setContent()` のダミーページしか触らないため、
 * `app-expo/dist` も静的サーバも不要。ビルド前の環境でも回せるよう webServer を止める
 * （dist が無いと serve-dist.mjs が起動に失敗し、実行そのものが始まらない）。
 */
const HARNESS_ONLY = !!process.env.HARNESS_ONLY;

/** 認証済みユーザーの storageState 保存先（setup プロジェクトが生成、gitignore 済み） */
export const STORAGE_STATE_PATH = path.resolve(__dirname, ".auth/user.json");

/**
 * 匿名セッションの storageState 保存先（anon-setup プロジェクトが生成、gitignore 済み）。
 *
 * Supabase の匿名サインインは「IP アドレスあたり 30 回/時」というレート制限があり、
 * かつ dev/prod で同一プロジェクトを共有しているため、テスト 1 件ごとに新規匿名ユーザーを
 * 作成する実装では E2E スイートを 1 回フルで回すだけで上限に達してしまう。
 * そのため匿名セッションも認証済みユーザーと同様に「1 回だけ作成して使い回す」方式にし、
 * 消費するレート制限枠を全プロジェクト合計で実質 1 回まで削減する。
 * （匿名サインイン自体の動作を検証する tests/smoke/boot.spec.ts のみ、意図的にこの
 *   storageState を使わずフレッシュな状態で実行する）
 */
export const ANON_STORAGE_STATE_PATH = path.resolve(__dirname, ".auth/anon.json");

/**
 * 既定の実行から除外するタグの正規表現を組み立てる。
 *
 * `grepInvert` は 1 つしか指定できないため、除外したいタグが増えても
 * 「どのタグを外したか」を見失わないようここで一括管理する。
 *
 * @returns 除外タグの正規表現（除外なしなら undefined）
 */
function buildExcludedTags(): RegExp | undefined {
	const excluded: string[] = [];
	if (!process.env.RUN_MUTATION) excluded.push("@mutation");
	if (!process.env.RUN_CATALOG) excluded.push("@catalog");
	return excluded.length > 0 ? new RegExp(excluded.join("|")) : undefined;
}

export default defineConfig({
	testDir: "./tests",

	// 各テストは独立しているため完全並列で実行し、実行時間を短縮する
	fullyParallel: true,

	// CI で test.only の消し忘れをエラーにする（ローカルでは許容）
	forbidOnly: !!process.env.CI,

	// 実 API・実ブラウザ相手のためネットワーク起因のフレークはありうる。CI のみ 2 回までリトライ
	retries: process.env.CI ? 2 : 0,

	// CI はリソースが限られるため並列数を絞る。ローカルは Playwright の自動判定に任せる
	workers: process.env.CI ? 2 : undefined,

	// HTML レポート（`pnpm report` で閲覧）+ コンソールの list 表示
	reporter: [["html", { open: "never" }], ["list"]],

	// 既定では実行しないタグ。
	// - @mutation (Tier 3): 共有 dev 環境の DB へ書き込むため「意図した時だけ」に限定する安全弁
	// - @catalog: UI カタログ用のスクリーンショット収集。検証ではないうえ実行が重いので、
	//   夜間 CI の Tier 1+2 とは切り離して RUN_CATALOG=1（= pnpm test:catalog）でのみ回す
	grepInvert: buildExcludedTags(),

	expect: {
		// 実 API (Cloud Run) を叩くため、既定の 5 秒では初回リクエストやコールドスタートで不安定になる。
		// アサーションのタイムアウトを 10 秒に延長してフレークを防ぐ
		timeout: 10_000,
	},

	use: {
		baseURL: BASE_URL,

		// ja-JP 中心でテストする方針（合意事項）。
		// app/index.tsx が navigator.language からロケールを解決して /ja-JP へリダイレクトするため、
		// ブラウザロケールを固定することでリダイレクト先が決定論的になる
		locale: "ja-JP",
		timezoneId: "Asia/Tokyo",

		// React Native Web は `testID` prop を DOM の `data-testid` 属性に変換する。
		// Playwright の getByTestId() の既定値と一致するが、依存関係を明示するためあえて記載
		testIdAttribute: "data-testid",

		// 失敗調査用のアーティファクト（成功時は収集せず実行を軽く保つ）
		// TODO: PW_FORCE_VISUALS=1 で成功時も screenshot/video を残す一時的な確認用スイッチ。
		// 常用すると実行が重くなるため、確認が終わったら "only-on-failure" / "retain-on-failure" に戻すこと
		trace: "on-first-retry",
		screenshot: process.env.PW_FORCE_VISUALS ? "on" : "only-on-failure",
		video: process.env.PW_FORCE_VISUALS ? "on" : "retain-on-failure",
	},

	projects: [
		// ── 認証セットアップ ───────────────────────────────────────────
		// Supabase テストユーザーで signInWithPassword し、セッションを localStorage に注入した
		// storageState (.auth/user.json) を生成する（Playwright 公式推奨の auth setup パターン）
		{
			name: "setup",
			testMatch: /tests\/setup\/auth\.setup\.ts/,
		},

		// ── 匿名セッションセットアップ ───────────────────────────────────
		// 匿名サインインを 1 回だけ行い、その storageState を desktop-chrome/mobile-* が
		// 共有で使い回す（レート制限対策。詳細は ANON_STORAGE_STATE_PATH のコメント参照）
		{
			name: "anon-setup",
			testMatch: /tests\/setup\/anon\.setup\.ts/,
		},

		// ── 設定整合性チェック（ブラウザ不要・依存なし） ─────────────────
		// firebase.json の rewrite と dist の整合性など、Node だけで完結する静的検証。
		// デプロイワークフローが「デプロイ前のゲート」として単独実行できるよう、
		// 他プロジェクトへの依存を持たせない
		{
			name: "config",
			testMatch: /tests\/config\//,
		},

		// ── デスクトップ（匿名ユーザー） ─────────────────────────────────
		// Tier 1 + Tier 2 をフル実行するメインプロジェクト。
		// anon-setup が確立した匿名セッションを再利用する
		// （boot.spec.ts だけは匿名サインイン自体を検証するため、ファイル内で
		//   test.use({ storageState: undefined }) してこの設定を上書きしている）
		{
			name: "desktop-chrome",
			use: { ...devices["Desktop Chrome"], storageState: ANON_STORAGE_STATE_PATH },
			testIgnore: [
				/tests\/setup\//,
				/tests\/authenticated\//,
				/tests\/config\//,
				/tests\/catalog\//,
				/tests\/harness\//,
			],
			dependencies: ["anon-setup"],
		},

		// ── E2E ハーネス自身の自己検証（アプリ・API・認証に依存しない） ─────
		// console error / pageerror を既定の失敗条件にするゲート（REL-08 / #1500）が
		// 壊れていないことを、意図的にエラーを出すダミーページで検証する専用プロジェクト。
		// アプリのビルド成果物も匿名セッションも要らないので、依存も storageState も持たせない
		// （= dist が無い環境でも `pnpm test:harness` 単独で回せる）
		{
			name: "harness",
			use: { ...devices["Desktop Chrome"] },
			testMatch: /tests\/harness\//,
		},

		// ── デスクトップ（ログイン済みユーザー） ─────────────────────────
		// tests/authenticated/ 配下のみを、setup が生成した storageState 付きで実行する
		{
			name: "desktop-chrome-authenticated",
			use: {
				...devices["Desktop Chrome"],
				storageState: STORAGE_STATE_PATH,
			},
			testMatch: /tests\/authenticated\//,
			dependencies: ["setup"],
		},

		// ── UI カタログ（スクリーンショット収集） ───────────────────────
		// 全画面のスクリーンショットを撮って catalog/screens.json の定義と突き合わせ、
		// 画面一覧ドキュメントを生成するための専用プロジェクト（@catalog タグで既定除外）。
		// 匿名 / ログイン済みで見える画面が異なるため、storageState 違いの 2 本に分けている。
		{
			name: "ui-catalog",
			use: { ...devices["Desktop Chrome"], storageState: ANON_STORAGE_STATE_PATH },
			testMatch: /tests\/catalog\/ui-catalog\.spec\.ts/,
			dependencies: ["anon-setup"],
		},
		{
			name: "ui-catalog-authenticated",
			use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE_PATH },
			// ログイン済みの収集（ui-catalog-authenticated）と、そこからしか到達できない
			// レビュー投稿フロー（ui-catalog-mutation。@mutation で既定は除外）の 2 本
			testMatch: /tests\/catalog\/ui-catalog-(authenticated|mutation)\.spec\.ts/,
			dependencies: ["setup"],
		},

		{
			name: "mobile-chrome",
			use: { ...devices["Pixel 7"], storageState: ANON_STORAGE_STATE_PATH },
			testMatch: /tests\/smoke\//,
			dependencies: ["anon-setup"],
		},
		{
			name: "mobile-safari",
			use: { ...devices["iPhone 14"], storageState: ANON_STORAGE_STATE_PATH },
			testMatch: /tests\/smoke\//,
			dependencies: ["anon-setup"],
		},
	],

	// PLAYWRIGHT_BASE_URL 指定時（デプロイ済み環境へのテスト時）と
	// HARNESS_ONLY 指定時（ハーネス自己検証のみ）はローカルサーバを起動しない
	webServer:
		process.env.PLAYWRIGHT_BASE_URL || HARNESS_ONLY
			? undefined
			: {
					// Firebase Hosting の配信挙動（[locale] rewrite + SPA fallback）を模した静的サーバ。
					// 既にポートが使用中の場合は再利用する（ローカルで serve:dist を手動起動している場合など）
					command: "node ./scripts/serve-dist.mjs",
					port: PORT,
					reuseExistingServer: !process.env.CI,
					timeout: 30_000,
				},
});
