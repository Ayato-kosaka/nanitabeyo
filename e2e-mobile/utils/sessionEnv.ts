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
		userId: "E2E_ANON_USER_ID",
	},
	authenticated: {
		accessToken: "E2E_AUTH_ACCESS_TOKEN",
		refreshToken: "E2E_AUTH_REFRESH_TOKEN",
		userId: "E2E_AUTH_USER_ID",
	},
} as const satisfies Record<SessionOwner, { accessToken: string; refreshToken: string; userId: string }>;

/**
 * 認証済みテストが実行可能か（= TEST_USER_EMAIL / TEST_USER_PASSWORD が設定され、ログインに成功したか）。
 * #1030 3-3 の「未設定時の自動 skip」を `describeAuthenticated` から判定するためのフラグ。
 */
export const AUTHENTICATED_AVAILABLE_ENV = "E2E_AUTHENTICATED_AVAILABLE";

/** アプリへ渡すセッション（launchArgs の中身に 1:1 対応する） */
export type E2ESession = {
	accessToken: string;
	refreshToken: string;
	/**
	 * このセッションの `auth.users.id`。
	 *
	 * #1030 【設計】B-1: アプリ側フック（app-expo/lib/e2e/injectTestSession.ts）は
	 * 「セッションの有無」ではなく **「期待ユーザーと現在ユーザーの一致」** で再注入を判断する契約になっており、
	 * `e2eExpectedUserId` が渡されないと **fail-loud で起動時に例外を投げる**。
	 * トークンだけ渡してもアプリは起動できないため、この 3 つは常にセットで扱うこと。
	 */
	userId: string;
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
	process.env[keys.userId] = session.userId;
}

/**
 * 環境変数からセッションを読み出す。
 *
 * @param owner セッションの持ち主
 * @returns 3 つ揃っていればセッション / 1 つでも欠けていれば null
 */
export function readSessionFromEnv(owner: SessionOwner): E2ESession | null {
	const keys = SESSION_ENV_KEYS[owner];
	const accessToken = process.env[keys.accessToken];
	const refreshToken = process.env[keys.refreshToken];
	const userId = process.env[keys.userId];
	// #1030 B-1: userId が欠けた状態で起動するとアプリ側フックが fail-loud で落ちる。
	// 「一部だけ揃っている」を成立させないため、1 つでも欠けていれば null にする
	if (!accessToken || !refreshToken || !userId) return null;
	return { accessToken, refreshToken, userId };
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

/**
 * @probe テスト（tests/probe/）が明示的に許可されているか。
 *
 * #1087 `tests/probe/` は **「修正が入るまで落ちるのが正しい」spec** を置く層。
 * アプリの不具合を客観的な数値で示すのが目的なので、夜間 CI の既定スコープ（tier1-2）へ混ぜると
 * 既存スコープが常時赤くなり、本物の回帰が埋もれる。そのため @mutation と同じ二重ガードで
 * 既定の探索から外す:
 * 1. 設定段（主防御）: jest.config.js の testPathIgnorePatterns が tests/probe/ を探索から外す
 * 2. コード段（二重ガード）: このフラグを見る `describeProbe` が skip する
 *
 * ⚠️ #1087 の修正が main へ入った時点で、この層の住人（先読み画像プローブ）は
 * 通常の回帰テスト（tests/search/preload-images.test.ts）へ昇格し、**現在この層は空**。
 * 仕組みだけを次の「落ちるのが正しい spec」のために残している（e2e-mobile/README.md 参照）。
 */
export function isProbeEnabled(): boolean {
	return process.env.RUN_PROBE === "1";
}
