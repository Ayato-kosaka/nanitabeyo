import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import type { E2ESession } from "./sessionEnv";

/**
 * 🔥 使い捨ての認証済みセッション（#1131 / ログアウトの spec 専用）
 *
 * ## なぜ globalSetup の共有セッションを使えないのか
 * アプリの `handleLogout` は `logout({ scope: "local" })` を呼ぶが、これは端末のストレージを消すだけでなく
 * `POST /auth/v1/logout?scope=local` で **そのセッションをサーバ側でも失効させる**。
 * e2e-mobile は run 全体で 1 つのログイン済みセッションを共有しているため（utils/sessionEnv.ts）、
 * そのセッションでログアウトすると、以降の `tests/authenticated/` が
 * 「注入した refresh token が失効している」状態になって軒並み落ちる。
 *
 * そこで **その spec のためだけに 1 セッション発行して、それを注入して壊す**。
 * e2e-web の `tests/authenticated/logout.spec.ts` が `signInTestUser()` で同じことをしている
 * （e2e-web/utils/testUserSession.ts）。ログアウトが失効させるのは自分で作ったセッションだけになる。
 *
 * ## レート制限との関係
 * `signInWithPassword` は **匿名サインイン（30 回/時/IP）とは別の枠**なので、この発行は
 * 匿名サインインのクォータを消費しない。消費するのは「ログアウト後に再確立される匿名セッション」の 1 回だけで、
 * それはこの spec の検証対象そのものである（#1131 提案 A）。
 *
 * ## セキュリティ（#1030 レビュー B-2 と同じ扱い）
 * - トークンは **ディスクへ書かない / ログへ出さない**（この関数も成否しか出力しない）
 * - 発行したセッションは spec 側の `afterAll` で必ず revoke する（`revokeDisposableSession`）。
 *   ログアウトまで到達した場合はサーバ側で既に失効しているが、途中で失敗した run のために必ず呼ぶこと
 */

/** Supabase 接続情報 + テストユーザーの認証情報 */
type TestUserCredentials = {
	supabaseUrl: string;
	supabaseAnonKey: string;
	email: string;
	password: string;
};

/**
 * テストユーザーの認証情報を環境変数から読み出す。
 *
 * globalSetup が既に `.env` を読み込み済みだが、テストワーカーが単独で起動された場合にも動くよう、
 * ここでも同じ 2 ファイルを読む（dotenv は既存の値を上書きしないため、CI の secrets が常に優先される）。
 *
 * @returns 1 つでも欠けていれば null（呼び出し側は `describeAuthenticated` で既に skip されている想定）
 */
function loadTestUserCredentials(): TestUserCredentials | null {
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
 * Node 側（テストワーカー）専用の supabase client を作る。
 *
 * #1030 レビュー M-4 と同じ理由で `persistSession` / `autoRefreshToken` は必ず無効にする。
 * 有効のままだと、この client が端末へ渡した refresh token をバックグラウンドでローテーションし、
 * 端末側のセッションを失効させてしまう。
 */
function createNodeClient(supabaseUrl: string, supabaseAnonKey: string) {
	return createClient(supabaseUrl, supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

/**
 * ログアウトで壊してよい、この spec 専用のログイン済みセッションを 1 つ発行する。
 *
 * @returns 発行したセッション（`launchAppWithSession({ session })` へそのまま渡せる形）
 * @失敗時 認証情報が無い / ログインに失敗した場合は日本語メッセージで例外を投げる（fail-loud）。
 *         黙って共有セッションへフォールバックすると、後続の authenticated テストを巻き添えで壊すため
 */
export async function createDisposableAuthenticatedSession(): Promise<E2ESession> {
	const credentials = loadTestUserCredentials();
	if (!credentials) {
		throw new Error(
			[
				"使い捨てセッションを発行できません（EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY /",
				"TEST_USER_EMAIL / TEST_USER_PASSWORD のいずれかが未設定）。",
				"  ログアウトの spec は共有セッションを壊せないため、専用セッションの発行が必須です。",
			].join("\n"),
		);
	}

	const supabase = createNodeClient(credentials.supabaseUrl, credentials.supabaseAnonKey);
	const { data, error } = await supabase.auth.signInWithPassword({
		email: credentials.email,
		password: credentials.password,
	});

	if (error || !data.session) {
		throw new Error(
			[
				`使い捨てセッションの発行（テストユーザーのログイン）に失敗しました: ${error?.message ?? "session is null"}`,
				"確認事項:",
				"  1. Supabase ダッシュボードで Email provider が ON になっているか",
				"  2. e2e-mobile/.env（CI では secrets）の TEST_USER_EMAIL / TEST_USER_PASSWORD が正しいか",
			].join("\n"),
		);
	}

	return {
		accessToken: data.session.access_token,
		refreshToken: data.session.refresh_token,
		// #1030 B-1: アプリ側フックは期待ユーザーとの一致で注入を判断するため必須
		userId: data.session.user.id,
	};
}

/**
 * 発行した使い捨てセッションを revoke する（後始末）。
 *
 * ⚠️ `scope: "local"` で revoke すること。`global` にすると **共有セッション（globalSetup 発行）まで
 * 失効させ**、後続の `tests/authenticated/` を壊す（utils/revokeSessions.ts が run 終了時に行う
 * `global` な revoke は、run の最後だからこそ許されている）。
 *
 * @param session 発行した使い捨てセッション
 * @失敗時 **例外を投げない**（警告のみ）。後始末の失敗で run を赤にしても得るものが無いため
 *         （utils/revokeSessions.ts と同じ方針）。ログアウトまで到達した run では
 *         セッションが既に失効しており、ここは «失敗するのが正常» になる
 */
export async function revokeDisposableSession(session: E2ESession): Promise<void> {
	const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
	if (!supabaseUrl || !supabaseAnonKey) return;

	try {
		const supabase = createNodeClient(supabaseUrl, supabaseAnonKey);
		const { error: setSessionError } = await supabase.auth.setSession({
			access_token: session.accessToken,
			refresh_token: session.refreshToken,
		});
		if (setSessionError) {
			// 既に失効している（= ログアウトが成功した）場合もここへ来る。トークンは絶対にログへ出さない
			console.log(`ℹ️ 使い捨てセッションは既に失効しています（revoke 不要）: ${setSessionError.message}`);
			return;
		}

		const { error } = await supabase.auth.signOut({ scope: "local" });
		if (error) {
			console.warn(`⚠️ 使い捨てセッションの revoke に失敗しました: ${error.message}`);
		}
	} catch (error) {
		console.warn(
			`⚠️ 使い捨てセッションの revoke で例外が発生しました: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
