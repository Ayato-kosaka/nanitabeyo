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
 * ## ⚠️ revoke は `scope: "local"` で行う（#2001 【バグ】）
 * かつてここは `scope: "global"` だった。global は **そのユーザーの全セッション**を失効させるため、
 * 「この run の後始末」のつもりの操作が **同時に走っている別 run のセッションまで巻き込む**。
 *
 * e2e-mobile の Android ジョブと iOS ジョブは **同じ workflow run の中で並走していて、
 * 同じテストユーザーでログインしている**。Android は 1 時間ほどで終わり、その globalTeardown が
 * global revoke を撃つ。iOS はそのあと 1 時間半以上走り続けるので、**以降の
 * `tests/authenticated/` が全部 `Invalid Refresh Token: Refresh Token Not Found` で死ぬ**。
 *
 * 実測（run 35662317482 / 2026-09-21 の夜間）:
 *   23:36:39  Android の globalTeardown が authenticated を global revoke
 *   23:51:57  iOS の以降の authenticated suite が軒並み refresh 失敗（19 失敗のうち 11 件）
 *
 * `local` は **この client に載っているセッションだけ**を失効させる。上の «なぜ必須なのか» が
 * 求めているのは「この run が発行したトークンを run 終了時に無効化すること」なので、
 * local で要件は満たせている（global である必要は最初から無かった）。
 *
 * 同じ理由で utils/disposableSession.ts も local を使っている。**ここへ global を戻さないこと**
 * （app-expo/scripts/assert-session-revoke-scope.mjs が CI で見張っている）。
 *
 * ここにあった「テストユーザーは e2e-web と共用なので両 nightly の cron 時刻を分離すること（#1029）」は、
 * **global をやめたことで «この revoke が理由» ではなくなった**ので消した。cron を分ける必要自体は
 * 残っている（Supabase の匿名サインイン枠 30 回/時/IP の取り合いを避けるため）が、それは
 * .github/workflows/e2e-mobile-test.yml の `schedule:` に書いてある。
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
 * 指定した持ち主のセッションを `signOut({ scope: "local" })` で revoke する。
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

		// #2001 【設計】local であること（理由はファイル先頭）。global は並走中の別ジョブを巻き込む
		const { error } = await supabase.auth.signOut({ scope: "local" });
		if (error) {
			console.warn(`⚠️ ${owner} セッションの revoke に失敗しました: ${error.message}`);
			return;
		}
		console.log(`🔒 ${owner} セッションを revoke しました（scope: local）`);
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
