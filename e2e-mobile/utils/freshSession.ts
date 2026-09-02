import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import { readSessionFromEnv, writeSessionToEnv, type E2ESession, type SessionOwner } from "./sessionEnv";

/**
 * ⏳ 共有セッションの «鮮度» を保証する（#1030 の設計が 1 時間を超える run で壊れる問題）
 *
 * ## 何が起きていたか（iOS の CI ログで確定）
 * globalSetup はセッションを **run の最初に 1 回だけ**確立する（#1030 3-1）。
 * Supabase の access token の寿命は **1 時間**。Android は全 suite が 16 分で終わるので
 * 無事だが、**iOS は 90〜150 分かかる**ため、run の途中で必ず期限が切れる。
 *
 * 切れた後に起きること（run 31607285195 で実測）:
 * - Node 側ヘルパが生の access token で API を叩いて **401**
 *   （`料理カテゴリの推薦取得に失敗しました（status=401）` @ 確立の 80 分後）
 * - アプリ側は `setSession` が期限切れを検知して **refresh token をローテーション**し、
 *   env に残った旧 refresh token が次の起動で注入されて reuse 検知に当たり、
 *   セッションファミリごと失効 → 以降の authenticated 起動が**ハング**
 *   （`Exceeded timeout of 600000ms` → ジョブの 3h タイムアウトで cancelled）
 *
 * 「iOS だけ落ちる」「毎回落ちる場所が微妙に違う」「run の後半ほど落ちる」という
 * 掴みどころのない症状は、すべてこの 1 点から出ていた。
 *
 * ## 直し方
 * セッションを使う直前に JWT の `exp` を見て、残りが少なければ **Node 側で refresh** し、
 * 新しいペアを `process.env` へ書き戻す。以降の利用（起動・API・revoke）は全て新ペアを見る。
 *
 * ## ⚠️ この方式は **maxWorkers: 1 が前提**（jest.config.js に明記済みの前提と同じ）
 * refresh は refresh token をローテーションする。ワーカーが複数いると
 * 「別ワーカーが旧トークンで refresh → reuse 検知 → ファミリ失効」が起きる。
 * env の書き戻しが効くのも同一プロセスだからこそ（jest はワーカーを跨いで env を同期しない）。
 *
 * ## マージンの決め方
 * 1 テストの上限は jest の 600 秒。テスト中にアプリ側の autoRefresh が発火して
 * ローテーションされると env が古くなるので、**起動時点で残り 15 分**を下回っていたら
 * 先に Node 側で更新しておく（1 時間寿命なら run 全体で高々 2〜3 回）。
 *
 * ## セキュリティ
 * トークンは **ログへ出さない**（このモジュールは残り時間の分数しか出力しない）。
 */

/** これを下回ったら refresh する（ms）。テスト 1 本の上限（600s）+ 余裕 */
const REFRESH_MARGIN_MS = 15 * 60 * 1000;

/** JWT の exp（秒）を取り出す。読めなければ null（= 期限不明として refresh に倒す） */
function jwtExpMs(accessToken: string): number | null {
	const parts = accessToken.split(".");
	if (parts.length < 2) return null;
	try {
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
		return typeof payload.exp === "number" ? payload.exp * 1000 : null;
	} catch {
		return null;
	}
}

function loadSupabaseEnv(): { url: string; anonKey: string } {
	dotenv.config({ path: path.resolve(__dirname, "../../app-expo/.env") });
	dotenv.config({ path: path.resolve(__dirname, "../.env") });
	const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
	const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !anonKey) {
		throw new Error("EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY が未設定です。");
	}
	return { url, anonKey };
}

/**
 * env のセッションを返す。期限が近ければ refresh して env を更新してから返す。
 *
 * @returns 鮮度が保証されたセッション。env に無ければ null（呼び出し側の従来分岐を保つ）
 * @失敗時 refresh に失敗した場合は fail-loud。旧トークンのまま先へ進むと
 *         「401」や「起動ハング」という**原因の読めない形**で後から壊れるため、ここで止める
 */
export async function ensureFreshSession(owner: SessionOwner): Promise<E2ESession | null> {
	const session = readSessionFromEnv(owner);
	if (!session) return null;

	const expMs = jwtExpMs(session.accessToken);
	const remainingMs = expMs === null ? 0 : expMs - Date.now();
	if (remainingMs > REFRESH_MARGIN_MS) return session;

	console.log(`⏳ ${owner} セッションの残りが ${Math.max(0, Math.round(remainingMs / 60000))} 分のため refresh します`);

	const { url, anonKey } = loadSupabaseEnv();
	// persistSession / autoRefreshToken は必ず無効（#1030 M-4。勝手なローテーションを防ぐ）
	const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
	const { data, error } = await client.auth.refreshSession({ refresh_token: session.refreshToken });

	if (error || !data.session) {
		throw new Error(
			[
				`${owner} セッションの refresh に失敗しました: ${error?.message ?? "session is null"}`,
				"  run が長時間化して refresh token が既にローテーション済み（reuse 検知）か、revoke 済みの可能性があります。",
				"  このまま旧トークンで続けると 401 や起動ハングになるため、ここで止めています。",
			].join("\n"),
		);
	}

	const fresh: E2ESession = {
		accessToken: data.session.access_token,
		refreshToken: data.session.refresh_token,
		userId: session.userId,
	};
	writeSessionToEnv(owner, fresh);
	return fresh;
}
