import * as path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import { revokeAllSessions } from "../utils/revokeSessions";
import { AUTHENTICATED_AVAILABLE_ENV, writeSessionToEnv } from "../utils/sessionEnv";

/**
 * 🚦 Jest globalSetup（Detox 公式 globalSetup のラッパー）
 *
 * ## 役割
 * 1. `.env` の読み込み（app-expo/.env → Supabase 接続情報 / e2e-mobile/.env → テストユーザー等）
 * 2. **Node 側**の supabase client でセッションを 1 回だけ確立し、`process.env` 経由でテストへ渡す
 *    - 匿名セッション … 全 spec が共有する（匿名サインインのクォータ消費を run あたり 1 回に抑える）
 *    - 認証済みセッション … TEST_USER_EMAIL / TEST_USER_PASSWORD が設定されている場合のみ
 * 3. Detox 公式の globalSetup を呼ぶ（デバイス割り当ての初期化）
 *
 * ## ⚠️ Detox の globalSetup は「置き換え」てはならない（#1030 レビュー M-6）
 * Detox 公式の Jest 連携は `globalSetup` / `globalTeardown` / `testEnvironment` / `reporter` の
 * 4 点セットで成立しており、独自ロジックが要る場合は **公式実装を import して呼んだうえで自前処理を足す**
 * ことが公式に指示されている。素朴に差し替えるとデバイス割り当てが壊れる。
 *
 * ## 実行順序
 * 「セッション確立 → Detox 初期化」の順にしている。認証情報の不備やレート制限は
 * **エミュレータを起動する前**に気付けた方が速く、CI 時間も無駄にしないため（fail-fast）。
 *
 * ## セキュリティ（#1030 レビュー B-2）
 * - トークンは **ディスクへ書かない**（`process.env` のみ）。Artifact 経由の漏洩面を作らないため
 * - トークンそのものは **絶対にログへ出さない**（このファイルは成否だけを出力する）
 * - run 終了時に fixtures/globalTeardown.ts が `signOut({ scope: "global" })` で revoke する
 */

// #1030 【設計】M-6: Detox 公式の globalSetup。型定義が提供されていないため require で読み込む
// eslint-disable-next-line @typescript-eslint/no-var-requires
const detoxGlobalSetup = require("detox/runners/jest/globalSetup") as () => Promise<void>;

export default async function globalSetup(): Promise<void> {
	loadEnvFiles();
	try {
		await establishSessions();
	} catch (error) {
		// #1030 【セキュリティ】B-2: 途中まで確立できたセッションを放置しない。
		// globalSetup が失敗すると Jest は globalTeardown を実行しないため、ここで自前で revoke する
		await revokeAllSessions();
		throw error;
	}
	await detoxGlobalSetup();
}

/**
 * `.env` を読み込む。
 *
 * #1030 【設計】3-3: Supabase の接続情報はアプリと同じものを使うため **app-expo/.env から読む**
 * （e2e-web の tests/setup/auth.setup.ts と同じ「重複管理を避ける」方針。CI では
 * `eas env:pull development --path .env` が app-expo/.env を生成する）。
 * テストユーザーの認証情報はローカルでは e2e-mobile/.env、CI では GitHub Secrets（= 既に process.env にある）。
 *
 * @副作用 process.env を書き換える（既存の値は上書きしない = CI の secrets が常に優先される）
 */
function loadEnvFiles(): void {
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

/**
 * 匿名セッションと（設定があれば）認証済みセッションを確立し、環境変数へ格納する。
 *
 * @失敗時
 * - 匿名サインインが 429（レート制限）… **リトライせず**日本語案内付きで例外を投げる
 * - テストユーザーの認証情報が設定済みなのにログインに失敗 … 例外を投げる（hard fail。#1030 m-8）
 * - Supabase 接続情報が未設定 … 警告のみ（boot スモークは launchArgs 不要で動くため）
 */
async function establishSessions(): Promise<void> {
	// #1030 【設計】3-3: 既定は「認証済みテストは実行不可」。ログイン成功時にだけ 1 を立てる
	process.env[AUTHENTICATED_AVAILABLE_ENV] = "0";

	const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

	if (!supabaseUrl || !supabaseAnonKey) {
		console.warn(
			[
				"⚠️ EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY が未設定のため、セッションの事前確立をスキップしました。",
				"   launchAppWithSession() を使う spec は失敗します（launchArgs 無しで起動する tests/smoke/boot.test.ts のみ実行可能）。",
				"   ローカルでは `cd app-expo && pnpx eas-cli env:pull development --path .env` を実行してください。",
			].join("\n"),
		);
		return;
	}

	await establishAnonymousSession(supabaseUrl, supabaseAnonKey);
	await establishAuthenticatedSession(supabaseUrl, supabaseAnonKey);
}

/**
 * 匿名セッションを 1 回だけ確立する。
 *
 * #1030 【設計】3-1: 全 spec がこの 1 つの匿名セッションを launchArgs 経由で共有する。
 * これにより「アプリのデータを何度消しても匿名サインインを消費しない」状態を作り、
 * 30 回/時/IP のレート制限（dev/prod 共有プロジェクト）を安全側に保つ。
 */
async function establishAnonymousSession(supabaseUrl: string, supabaseAnonKey: string): Promise<void> {
	const supabase = createNodeClient(supabaseUrl, supabaseAnonKey);
	const { data, error } = await withNetworkRetry("匿名サインイン", () => supabase.auth.signInAnonymously());

	if (error || !data.session) {
		// #1030 【設計】レビュー 3.2: 匿名サインインの 30 回/時/IP は Supabase 公式が「カスタマイズ不可」と
		// 明記しており、窓が 1 時間なので **リトライは run を無駄に長引かせるだけ**。ここは fail-fast させる
		if (error?.status === 429) {
			throw new Error(
				[
					"匿名サインインがレート制限（429）に達しました。リトライせず中断します。",
					"  Supabase の匿名サインインは 30 回/時/IP（カスタマイズ不可）で、dev/prod で同一プロジェクトを共有しています。",
					"  対処:",
					"    1. 他の E2E ワークフロー（e2e-web の nightly 等）が同時実行されていないか確認する",
					"    2. GitHub ホストランナーの IP は他テナントと共有のため、1 時間ほど待ってから再実行する",
				].join("\n"),
			);
		}
		throw new Error(`匿名セッションの確立に失敗しました: ${error?.message ?? "session is null"}`);
	}

	writeSessionToEnv("anon", {
		accessToken: data.session.access_token,
		refreshToken: data.session.refresh_token,
		// #1030 B-1: アプリ側フックが「期待ユーザーと現在ユーザーの一致」で再注入を判断するため必須
		userId: data.session.user.id,
	});
	console.log("✅ 匿名セッションを確立しました（全 spec で共有します）");
}

/**
 * テストユーザーでログインし、認証済みセッションを確立する。
 *
 * #1030 【設計】3-3: 認証情報が未設定なら skip（`describeAuthenticated` が spec ごと skip する）。
 * **設定済みなのに失敗した場合は hard fail**（m-8）。skip にすると認証済みテストが黙って消え、
 * 「実行されていないのに緑」という最悪の状態になるため。
 */
async function establishAuthenticatedSession(supabaseUrl: string, supabaseAnonKey: string): Promise<void> {
	const email = process.env.TEST_USER_EMAIL;
	const password = process.env.TEST_USER_PASSWORD;

	if (!email || !password) {
		console.log(
			"ℹ️ TEST_USER_EMAIL / TEST_USER_PASSWORD が未設定のため、tests/authenticated/ 配下は自動的にスキップされます",
		);
		return;
	}

	const supabase = createNodeClient(supabaseUrl, supabaseAnonKey);
	const { data, error } = await withNetworkRetry("テストユーザーのログイン", () =>
		supabase.auth.signInWithPassword({ email, password }),
	);

	if (error || !data.session) {
		throw new Error(
			[
				`テストユーザーのログインに失敗しました: ${error?.message ?? "session is null"}`,
				"確認事項:",
				"  1. Supabase ダッシュボードで Email provider が ON になっているか（OFF だと 'Email logins are disabled' で失敗する）",
				"  2. e2e-mobile/.env（CI では secrets）の TEST_USER_EMAIL / TEST_USER_PASSWORD が正しいか",
			].join("\n"),
		);
	}

	writeSessionToEnv("authenticated", {
		accessToken: data.session.access_token,
		refreshToken: data.session.refresh_token,
		userId: data.session.user.id,
	});
	process.env[AUTHENTICATED_AVAILABLE_ENV] = "1";
	console.log("✅ テストユーザーのセッションを確立しました（tests/authenticated/ を実行します）");
}

/**
 * Supabase 呼び出しを **ネットワーク起因の失敗に限って**再試行する。
 *
 * #1027 【バグ】run 30445542854 の iOS は、globalSetup の `signInAnonymously()` が
 * `ConnectTimeoutError`（supabase.co:443 へ 10 秒で接続できず）になり、テストを 1 件も実行できずに終わった。
 * ランナーから外部への一時的な到達不能は再試行で吸収できる種類の失敗で、
 * ここで落とすと **ビルドに費やした 26 分がまるごと無駄になる**。
 *
 * ⚠️ ただし再試行してよいのは「応答が返ってこなかった」場合だけ。
 * 4xx（429 のレート制限・401 の認証情報誤りなど）は待っても直らず、
 * とくに 429 は窓が 1 時間・上限変更不可なので **再試行が run を長引かせるだけ**になる（#1030 3.2）。
 * 判定は「HTTP ステータスが取れたか」で行い、取れた時点で即座に呼び出し元へ返す。
 *
 * @param label ログに出す処理名（トークン等は絶対に含めないこと）
 * @param call 実行する Supabase 呼び出し
 * @returns 最後の呼び出しの結果（成功・失敗いずれも呼び出し元が従来どおり判定する）
 */
async function withNetworkRetry<T extends { error: { status?: number } | null }>(
	label: string,
	call: () => Promise<T>,
): Promise<T> {
	const MAX_ATTEMPTS = 3;
	let result = await call();

	for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
		// 成功、または HTTP ステータスが返っている（= サーバまで届いている）なら再試行しない
		if (!result.error || typeof result.error.status === "number") return result;

		const waitMs = 2_000 * attempt;
		console.warn(
			`⚠️ ${label} がネットワーク起因で失敗しました。${waitMs}ms 後に再試行します（${attempt}/${MAX_ATTEMPTS - 1}）`,
		);
		await new Promise((resolve) => setTimeout(resolve, waitMs));
		result = await call();
	}

	return result;
}

/**
 * Node 側（テストランナー）専用の supabase client を作る。
 *
 * #1030 【設計】レビュー M-4: `persistSession: false` に加えて **`autoRefreshToken: false` が必須**。
 * 既定（true）のままだと、この client が run 中にバックグラウンドでトークンをローテーションし、
 * 端末へ渡した refresh_token を無効化してしまう（端末側との二重所有によるセッション失効）。
 */
function createNodeClient(supabaseUrl: string, supabaseAnonKey: string): SupabaseClient {
	return createClient(supabaseUrl, supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}
