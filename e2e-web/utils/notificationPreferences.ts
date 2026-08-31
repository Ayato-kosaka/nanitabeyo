import type { BrowserContext, Route } from "@playwright/test";

/**
 * 🔔 #1510 SET-02 通知カテゴリ別の受信設定 API をスタブする。
 *
 * ## なぜ実 API を使わないのか
 * 1. この設定は `user_notification_preferences` テーブルに依存する。**このテーブルを作る
 *    migration はまだ適用されていない**（オーナー承認待ち。PR 本文の「DB マイグレーションを
 *    含みます（未適用）」参照）ため、実 API では GET が失敗する。
 * 2. 仮に適用済みでも、PATCH は共有 dev アカウントの設定を**実際に書き換える**。
 *    このテストが見たいのは画面の挙動であって、共有環境の状態を変えることではない。
 *
 * ## CORS の扱い
 * バックエンドは別オリジン (Cloud Run) で、`app-expo/lib/fetchWithAuth.ts` は web で
 * `credentials: "include"` を使うため `access-control-allow-origin: *` は使えない。
 * `utils/network.ts` の既存スタブと同じくリクエスト元 origin をそのまま返す。
 *
 * ## レスポンスの封筒
 * `useAPICall` は `BaseResponse<R>` の `data` だけを呼び出し側へ返す。
 * 素の配列・素のオブジェクトを返すと `invalid_response` になるので、
 * 必ず `{ success: true, data: ... }` で包むこと。
 */

/** 設定 API のカテゴリ key（shared/api/v1/constants/notificationCategories.ts と一致させる） */
export type StubbedNotificationCategory = "likes" | "saves" | "group_votes";

/** スタブが観測した PATCH リクエスト */
export type NotificationPreferenceStub = {
	/** これまでに観測した PATCH の (category, enabled) を古い順に返す */
	updates(): { category: string; enabled: boolean }[];
	/** サーバー側の現在値（PATCH を反映したもの） */
	current(): Record<string, boolean>;
};

export type StubNotificationPreferencesOptions = {
	/** GET の初期値。省略したカテゴリは true（＝既定オン）になる */
	initial?: Partial<Record<StubbedNotificationCategory, boolean>>;
	/** PATCH を必ず 500 で失敗させる（楽観更新のロールバック検証用） */
	failUpdates?: boolean;
	/** GET を必ず 500 で失敗させる（読み込み失敗表示の検証用） */
	failLoad?: boolean;
};

const CATEGORIES: StubbedNotificationCategory[] = ["likes", "saves", "group_votes"];

const corsHeaders = async (route: Route): Promise<Record<string, string>> => {
	const origin = (await route.request().headerValue("origin")) ?? "*";
	return {
		"access-control-allow-origin": origin,
		"access-control-allow-credentials": "true",
	};
};

export async function stubNotificationPreferences(
	context: BrowserContext,
	options: StubNotificationPreferencesOptions = {},
): Promise<NotificationPreferenceStub> {
	const { initial = {}, failUpdates = false, failLoad = false } = options;

	const state: Record<string, boolean> = {};
	for (const category of CATEGORIES) {
		state[category] = initial[category] ?? true;
	}
	const observedUpdates: { category: string; enabled: boolean }[] = [];

	// PATCH（末尾に /:category が付く）を先に登録する。Playwright は
	// **後から登録したルートが優先**されるため、この順序を逆にすると
	// コレクション側のパターンが個別カテゴリの PATCH まで飲み込む
	await context.route("**/v1/users/me/notification-preferences/*", async (route: Route) => {
		const headers = await corsHeaders(route);
		if (route.request().method().toUpperCase() !== "PATCH") {
			await route.fulfill({ status: 405, headers, contentType: "application/json", body: "{}" });
			return;
		}

		const category = new URL(route.request().url()).pathname.split("/").pop() ?? "";
		const body = route.request().postDataJSON() as { enabled?: boolean } | null;
		const enabled = !!body?.enabled;
		observedUpdates.push({ category, enabled });

		if (failUpdates) {
			await route.fulfill({
				status: 500,
				headers,
				contentType: "application/json",
				body: JSON.stringify({ success: false, message: "stubbed failure" }),
			});
			return;
		}

		state[category] = enabled;
		await route.fulfill({
			status: 200,
			headers,
			contentType: "application/json",
			body: JSON.stringify({ success: true, data: { category, enabled } }),
		});
	});

	await context.route("**/v1/users/me/notification-preferences", async (route: Route) => {
		const headers = await corsHeaders(route);

		if (failLoad) {
			await route.fulfill({
				status: 500,
				headers,
				contentType: "application/json",
				body: JSON.stringify({ success: false, message: "stubbed failure" }),
			});
			return;
		}

		await route.fulfill({
			status: 200,
			headers,
			contentType: "application/json",
			body: JSON.stringify({
				success: true,
				data: { data: CATEGORIES.map((category) => ({ category, enabled: state[category] })) },
			}),
		});
	});

	return {
		updates: () => [...observedUpdates],
		current: () => ({ ...state }),
	};
}
