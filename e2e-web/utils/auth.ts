import type { Page } from "@playwright/test";

/**
 * 🔐 認証まわりのユーティリティ
 *
 * このアプリの認証は Supabase を使用しており、Web では localStorage の
 * `sb-<projectRef>-auth-token` キーにセッション JSON が保存される。
 * - 匿名ユーザー: AuthProvider が起動時に `signInAnonymously()` を自動実行して保存
 * - ログイン済み: tests/setup/auth.setup.ts が signInWithPassword の結果を storageState として注入
 */

/**
 * Supabase プロジェクト URL から localStorage のセッション保存キーを導出する。
 * supabase-js は `sb-<projectRef>-auth-token` という命名でセッションを保存する仕様。
 *
 * @param supabaseUrl 例: "https://ummdqpyirmkkryzkolsq.supabase.co"
 * @returns 例: "sb-ummdqpyirmkkryzkolsq-auth-token"
 */
export function supabaseStorageKey(supabaseUrl: string): string {
	const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
	return `sb-${projectRef}-auth-token`;
}

/**
 * 匿名セッションが localStorage に確立されるまで待機する。
 *
 * AuthProvider は起動時にセッションが無ければ `signInAnonymously()` を実行するが、
 * これは非同期のため、画面表示直後に API を叩くテストは JWT 未取得でフレークしうる。
 * API 呼び出しを伴うテストは、操作前に必ずこの関数でセッション確立を待つこと。
 *
 * @param page 対象ページ
 * @param timeout タイムアウト (ms)。Supabase への初回リクエストを考慮し既定 15 秒
 */
export async function waitForAnonymousSession(page: Page, timeout = 15_000): Promise<void> {
	await page.waitForFunction(
		// supabase-js のキー命名規則 `sb-*-auth-token` に一致するキーの出現を待つ
		() => Object.keys(window.localStorage).some((key) => key.startsWith("sb-") && key.endsWith("-auth-token")),
		undefined,
		{ timeout },
	);
}
