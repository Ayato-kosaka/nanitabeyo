import { createClient } from "@supabase/supabase-js";

import { SESSION_ENV_KEYS, readSessionFromEnv, type SessionOwner } from "./sessionEnv";

/**
 * 🔒 この run で発行したセッションの revoke
 *
 * ## なぜ必須なのか（#1030 レビュー B-2 / 確定設計の MUST）
 * launchArgs でアプリへ渡す `refresh_token` は **長期資格情報**であり、access_token の 1 時間とは無関係に
 * 交換可能なまま残る。このリポジトリは public で Actions の Artifact は実質誰でも取得できるため、
 * 万一ログ等にトークンが載ると「有効な資格情報が公開状態で残る」ことになる。
 * run 終了時にセッションファミリごと revoke することが、被害を **「run 終了まで」に構造的に限定する唯一の手段**。
 *
 * ## 既知の副作用
 * テストユーザーは e2e-web と共用のため、`scope: "global"` の signOut は
 * **同時実行中の e2e-web のセッションも失効させる**。両 nightly の cron 時刻は分離すること（#1029）。
 */

/**
 * 環境変数に残っている全セッション（匿名 / 認証済み）を revoke する。
 *
 * globalTeardown（正常終了時）と globalSetup の失敗時の後始末の両方から呼ばれる。
 *
 * @失敗時 **例外を投げない**（警告のみ）。後始末の失敗で run を赤にしても得るものが無く、
 *         呼び出し側（Detox の後始末・元の例外の再送出）を阻害しないことを優先する
 */
export async function revokeAllSessions(): Promise<void> {
	for (const owner of ["anon", "authenticated"] as SessionOwner[]) {
		await revokeSession(owner);
	}
}

/**
 * 指定した持ち主のセッションを `signOut({ scope: "global" })` で revoke する。
 *
 * @param owner セッションの持ち主
 */
async function revokeSession(owner: SessionOwner): Promise<void> {
	const session = readSessionFromEnv(owner);
	if (!session) return;

	const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
	if (!supabaseUrl || !supabaseAnonKey) return;

	try {
		// #1030 【設計】M-4: 後始末用の client も persistSession / autoRefreshToken は必ず無効にする
		const supabase = createClient(supabaseUrl, supabaseAnonKey, {
			auth: { persistSession: false, autoRefreshToken: false },
		});

		// signOut は「現在のセッション」に対して働くため、まず revoke 対象のセッションを client へ載せる
		const { error: setSessionError } = await supabase.auth.setSession({
			access_token: session.accessToken,
			refresh_token: session.refreshToken,
		});
		if (setSessionError) {
			// #1030 【セキュリティ】トークンそのものは絶対にログへ出さない（原因メッセージのみ）
			console.warn(`⚠️ ${owner} セッションの復元に失敗したため revoke をスキップします: ${setSessionError.message}`);
			return;
		}

		const { error } = await supabase.auth.signOut({ scope: "global" });
		if (error) {
			console.warn(`⚠️ ${owner} セッションの revoke に失敗しました: ${error.message}`);
			return;
		}
		console.log(`🔒 ${owner} セッションを revoke しました（scope: global）`);
	} catch (error) {
		console.warn(`⚠️ ${owner} セッションの revoke 中に例外が発生しました: ${(error as Error).message}`);
	} finally {
		// #1030 【設計】revoke 済みのトークンを環境変数に残さない（後続処理からの誤用防止）
		delete process.env[SESSION_ENV_KEYS[owner].accessToken];
		delete process.env[SESSION_ENV_KEYS[owner].refreshToken];
		// userId は資格情報ではないが、トークンだけ消えて「セッションが半分残っている」状態を作らないよう揃えて消す
		delete process.env[SESSION_ENV_KEYS[owner].userId];
	}
}
