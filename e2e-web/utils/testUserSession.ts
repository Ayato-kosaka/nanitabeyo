import * as path from "node:path";
import * as dotenv from "dotenv";
import { createClient, type Session } from "@supabase/supabase-js";

/**
 * 🔑 テストユーザーのセッション取得（Node 側 = テストランナー内で実行する）
 *
 * このアプリのログイン UI は Google/Apple OAuth のみで外部 IdP は自動化できないため、
 * E2E は「Supabase の dev プロジェクトに事前作成した email+password テストユーザーで
 * API レベルのログインを行い、得たセッションを localStorage へ注入する」方式を採る。
 *
 * 利用者は 2 か所:
 * - tests/setup/auth.setup.ts … 全 authenticated テストで共有する storageState を作る
 * - tests/authenticated/logout.spec.ts … セッションを破壊するため **専用セッション** を都度作る
 */

/** テストユーザーでログインするために必要な設定一式 */
export type TestUserCredentials = {
	supabaseUrl: string;
	supabaseAnonKey: string;
	email: string;
	password: string;
};

/**
 * テストユーザーの認証情報を環境変数から読み出す。
 *
 * - Supabase の接続情報はフロントエンドと同じものを使うため app-expo/.env から読む（重複管理を避ける）
 * - テストユーザーの認証情報は e2e-web/.env から読む（コミット禁止）
 * - 既に process.env に設定済みの値（CI の secrets 等）が優先される（dotenv は上書きしない）
 *
 * @returns 1 つでも欠けている場合は null（呼び出し側で skip する）
 */
export function loadTestUserCredentials(): TestUserCredentials | null {
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });

	const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
	const email = process.env.TEST_USER_EMAIL;
	const password = process.env.TEST_USER_PASSWORD;

	if (!supabaseUrl || !supabaseAnonKey || !email || !password) return null;
	return { supabaseUrl, supabaseAnonKey, email, password };
}

/**
 * テストユーザーで signInWithPassword し、新しいセッションを 1 つ発行する。
 *
 * ⚠️ 呼ぶたびに Supabase 側の **セッションが 1 つ増える**（＝ 独立したリフレッシュトークン系列）。
 * ログアウトを実行する spec はこれを使って自分専用のセッションを持つこと。共有 storageState の
 * セッションでログアウトすると `/logout?scope=local` がそのセッションをサーバ側で失効させ、
 * 以降の authenticated テストが 403 で軒並み落ちる（実測済み）。
 *
 * なお匿名サインイン（30 回/時/IP）とは別のレート制限枠なので、
 * ここでの呼び出しは匿名サインインの枠を消費しない。
 *
 * @throws ログインに失敗した場合（原因の切り分け手順をメッセージに含める）
 */
export async function signInTestUser(credentials: TestUserCredentials): Promise<Session> {
	// persistSession: false — Node 側でセッションを保存する必要はない（呼び出し側が使うだけ）
	const supabase = createClient(credentials.supabaseUrl, credentials.supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const { data, error } = await supabase.auth.signInWithPassword({
		email: credentials.email,
		password: credentials.password,
	});
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
	return data.session;
}
