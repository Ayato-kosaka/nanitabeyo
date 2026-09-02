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

/** localStorage に保存されている Supabase セッションのユーザー情報（最小限） */
export type StoredSessionUser = {
	/** auth.users.id */
	id: string;
	/** 匿名サインインで作られたユーザーか（Supabase の `user.is_anonymous`） */
	isAnonymous: boolean;
};

/**
 * localStorage に保存されている Supabase セッションのユーザーを読み出す。
 *
 * 「ログアウト後に **別の匿名ユーザーとして** セッションが再確立されたか」を
 * 見分けるために使う（キーの有無だけを見る {@link waitForAnonymousSession} では、
 * ログアウト前のログイン済みセッションが残っているだけの状態と区別できない）。
 *
 * 値の形式は tests/setup/auth.setup.ts が書き込むものと同じ「Session の JSON そのまま」。
 * ページ遷移の最中は実行コンテキストが破棄されて evaluate が例外になりうるため、
 * 呼び出し側は expect.poll などで再試行すること。
 *
 * @returns セッションが無い / 壊れている場合は null
 */
export async function readStoredSessionUser(page: Page): Promise<StoredSessionUser | null> {
	return page.evaluate(() => {
		const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
		if (!key) return null;
		const raw = window.localStorage.getItem(key);
		if (!raw) return null;
		try {
			const user = JSON.parse(raw)?.user;
			if (typeof user?.id !== "string") return null;
			return { id: user.id, isAnonymous: user.is_anonymous === true };
		} catch {
			// サインアウト処理の途中など、書き換え中の値を読んだ場合は「まだ無い」として扱う
			return null;
		}
	});
}
