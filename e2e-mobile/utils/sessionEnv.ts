/**
 * 🔑 Node 側で確立したセッションを「テストワーカーへ受け渡す」ための env 規約
 *
 * ## なぜ env なのか（#1030 3-3 / リスク2）
 * globalSetup で取得したセッション（access_token / refresh_token）は **ディスクへ書かない**。
 * ファイルに落とすと Detox の artifacts ごと GitHub Actions の Artifact にアップロードされ、
 * public リポジトリでは実質誰でも取得できてしまう（#1030 レビュー B-2）。
 * Jest の globalSetup はテストワーカーが fork される前に実行されるため、
 * ここで `process.env` に代入した値はワーカー側からもそのまま読める。
 *
 * ## 命名規約
 * - `E2E_` プレフィックスで統一する（アプリへ渡す launchArgs 側は `e2e` プレフィックス。#1030 3-2）
 * - **値はトークン文字列そのもの**。ログへ出さないこと（このモジュールも一切 console 出力しない）
 */

/** セッションの持ち主。アプリ側フックが「期待ユーザーと現在ユーザーの一致」を判定するために使う（#1030 B-1） */
export type SessionOwner = "anon" | "authenticated";

/** globalSetup ↔ テストワーカー間で共有する環境変数名 */
export const SESSION_ENV_KEYS = {
	anon: {
		accessToken: "E2E_ANON_ACCESS_TOKEN",
		refreshToken: "E2E_ANON_REFRESH_TOKEN",
	},
	authenticated: {
		accessToken: "E2E_AUTH_ACCESS_TOKEN",
		refreshToken: "E2E_AUTH_REFRESH_TOKEN",
	},
} as const satisfies Record<SessionOwner, { accessToken: string; refreshToken: string }>;

/**
 * 認証済みテストが実行可能か（= TEST_USER_EMAIL / TEST_USER_PASSWORD が設定され、ログインに成功したか）。
 * #1030 3-3 の「未設定時の自動 skip」を `describeAuthenticated` から判定するためのフラグ。
 */
export const AUTHENTICATED_AVAILABLE_ENV = "E2E_AUTHENTICATED_AVAILABLE";

/** アプリへ渡すセッション（launchArgs の中身に 1:1 対応する） */
export type E2ESession = {
	accessToken: string;
	refreshToken: string;
};

/**
 * セッションを環境変数へ書き出す（globalSetup 専用）。
 *
 * @param owner セッションの持ち主
 * @param session Node 側 supabase client が発行したセッション
 * @副作用 process.env を書き換える（ディスクへは書かない）
 */
export function writeSessionToEnv(owner: SessionOwner, session: E2ESession): void {
	const keys = SESSION_ENV_KEYS[owner];
	process.env[keys.accessToken] = session.accessToken;
	process.env[keys.refreshToken] = session.refreshToken;
}

/**
 * 環境変数からセッションを読み出す。
 *
 * @param owner セッションの持ち主
 * @returns 両方のトークンが揃っていればセッション / 1 つでも欠けていれば null
 */
export function readSessionFromEnv(owner: SessionOwner): E2ESession | null {
	const keys = SESSION_ENV_KEYS[owner];
	const accessToken = process.env[keys.accessToken];
	const refreshToken = process.env[keys.refreshToken];
	if (!accessToken || !refreshToken) return null;
	return { accessToken, refreshToken };
}

/** 認証済みテストが実行可能かどうか（globalSetup が判定して立てたフラグを読むだけ） */
export function isAuthenticatedAvailable(): boolean {
	return process.env[AUTHENTICATED_AVAILABLE_ENV] === "1";
}

/**
 * @mutation テストが明示的に許可されているか。
 *
 * #1030 レビュー M-3: 「実行コマンドに依存しない」安全弁にするため、
 * jest.config.js の testPathIgnorePatterns（設定段）とこのフラグ（コード段）の二重ガードにしている。
 */
export function isMutationEnabled(): boolean {
	return process.env.RUN_MUTATION === "1";
}
