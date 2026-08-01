import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { test as setup } from "@playwright/test";
import { STORAGE_STATE_PATH } from "../../playwright.config";
import { supabaseStorageKey } from "../../utils/auth";

/**
 * 🔐 認証セットアップ（Playwright 公式推奨の auth setup project パターン）
 *
 * ## 背景
 * このアプリのログイン UI は Google/Apple OAuth のみで、外部 IdP のログイン画面は
 * Playwright で自動化できない（bot 検知・利用規約の観点でもアンチパターン）。
 * そこで「Supabase の dev プロジェクトに事前作成した email+password テストユーザーで
 * API レベルのログインを行い、得たセッションを localStorage に注入する」方式を採る。
 *
 * ## 仕組み
 * 1. supabase-js の signInWithPassword でセッション（JWT）を取得
 * 2. アプリ (supabase-js) がセッションを探す localStorage キー `sb-<projectRef>-auth-token` に
 *    セッション JSON を書き込んだ storageState (.auth/user.json) を保存
 * 3. `desktop-chrome-authenticated` プロジェクトがこの storageState を全テストで再利用
 *    → アプリはリロード時にセッションを検出し「ログイン済みユーザー」として起動する
 *
 * ## 前提（e2e-web/README.md 参照）
 * - Supabase dev プロジェクトで Email provider が ON（Allow new users to sign up は OFF 推奨）
 * - テストユーザーが作成済みで、認証情報が e2e-web/.env に設定されていること
 *   （TEST_USER_EMAIL / TEST_USER_PASSWORD。コミット禁止）
 */

// Supabase の接続情報はフロントエンドと同じものを使うため app-expo/.env から読む（重複管理を避ける）
dotenv.config({ path: path.resolve(__dirname, "../../../app-expo/.env") });
// テストユーザーの認証情報は e2e-web/.env から読む
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

setup("テストユーザーでログインし storageState を生成する", async ({}) => {
	const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
	const email = process.env.TEST_USER_EMAIL;
	const password = process.env.TEST_USER_PASSWORD;

	// 認証情報が未設定の場合: 空の storageState を書き出して skip する。
	// （storageState ファイル自体が無いと authenticated プロジェクトの起動が失敗するため、
	//   「匿名状態のファイル」を置いた上で各テスト側の skip 条件に委ねる）
	if (!supabaseUrl || !supabaseAnonKey || !email || !password) {
		fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
		fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify({ cookies: [], origins: [] }, null, "\t"));
		setup.skip(
			true,
			"TEST_USER_EMAIL / TEST_USER_PASSWORD（e2e-web/.env）または Supabase 接続情報（app-expo/.env）が未設定のため、認証セットアップをスキップしました",
		);
		return;
	}

	// persistSession: false — Node 側でセッションを保存する必要はない（storageState にのみ書き出す）
	const supabase = createClient(supabaseUrl, supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const { data, error } = await supabase.auth.signInWithPassword({ email, password });
	if (error || !data.session) {
		throw new Error(
			[
				`テストユーザーのログインに失敗しました: ${error?.message}`,
				"確認事項:",
				"  1. Supabase ダッシュボードで Email provider が ON になっているか（OFF だと 'Email logins are disabled' で失敗する）",
				"  2. e2e-web/.env の TEST_USER_EMAIL / TEST_USER_PASSWORD が正しいか",
			].join("\n"),
		);
	}

	// テスト対象オリジン（playwright.config.ts の BASE_URL と同じ導出ロジック）
	const origin = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 4173}`;

	// supabase-js が読み取る localStorage キーへ、セッション JSON をそのまま格納した storageState を生成する
	const storageState = {
		cookies: [],
		origins: [
			{
				origin,
				localStorage: [
					{
						name: supabaseStorageKey(supabaseUrl),
						value: JSON.stringify(data.session),
					},
				],
			},
		],
	};

	fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
	fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, "\t"));
});
