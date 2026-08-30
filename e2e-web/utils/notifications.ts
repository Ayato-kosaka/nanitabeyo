import type { Page } from "@playwright/test";
import type { NotificationItem } from "@shared/api/v1/res";

/**
 * 🔔 通知一覧（GET /v1/notifications）の E2E 用ユーティリティ（#1506 GRP-04）
 *
 * ## なぜ API をモックするのか
 * 検証対象は「**投票完了通知が一覧に出て、押すと投票結果画面へ行く**」という
 * クライアント側の分岐（app/[locale]/(tabs)/notifications/index.tsx の `handleNotificationPress` /
 * `getNotificationIcon` / i18n キー解決）であって、通知が作られるサーバ側の経路ではない。
 *
 * 実データで撮ろうとすると、
 * - ホストとは **別ユーザー** が投票を完了する（テストユーザーは 1 人しか無い）
 * - Cloud Tasks の非同期ジョブが通知行を作り終えるのを待つ
 * という、検証対象と無関係な前提が要る。サーバ側は API のユニットテスト
 * （api/src/v1/dish-category-group-votes/dish-category-group-votes.service.spec.ts と
 *  api/src/internal/notifications/notification-job.service.spec.ts）が担保しているので、
 * ここは `page.route()` で決定論的に固定する。
 *
 * ## dev DB への影響
 * **無し**。通知一覧画面は入場時に `markAllAsRead()`（= 既読状態の書き込み）を呼ぶが、
 * その POST もここでモックするため実 API へは届かない。だからこの spec は @mutation ではない。
 * （e2e-mobile 側の同名テストは Detox にネットワーク傍受が無いので @mutation に置いている）
 *
 * ⚠️ **BaseResponse の封筒 `{ success, data }` を外さないこと。**
 * `useAPICall` は `data` だけを取り出すので、素の配列を返すと undefined が渡って
 * 画面が空表示になる（utils/dishCategoryGroupVote.ts に同じ事故の記録がある）。
 */

/** 一覧 API。`/unread-count` や `/mark-all-read` とは一致させないため末尾を閉じる */
const LIST_URL_PATTERN = /\/v1\/notifications(\?.*)?$/;
/** 未読数 API（画面入場時に呼ばれる） */
const UNREAD_COUNT_URL_PATTERN = /\/v1\/notifications\/unread-count(\?.*)?$/;
/** 一括既読 API（画面入場時に呼ばれる。実 API へ流すと dev DB が書き変わる） */
const MARK_ALL_READ_URL_PATTERN = /\/v1\/notifications\/mark-all-read(\?.*)?$/;

/** 投票通知が指す投票セッションの shareToken。結果画面の route param になる */
export const MOCK_VOTE_NOTIFICATION_SHARE_TOKEN = "e2e-1506-share-token";

/** 投票通知が指す投票セッションの内部 id（notifications.target_id） */
export const MOCK_VOTE_NOTIFICATION_SESSION_ID = "00000000-0000-4000-8000-000000001506";

/** 投票してくれた参加者（通知のアクター）の表示名 */
export const MOCK_VOTE_ACTOR_NAME = "投票してくれた人";

/** 通知一覧画面の URL（`(tabs)` は Expo Router のグループなので URL には現れない） */
export function notificationsScreenPath(): string {
	return "/ja-JP/notifications";
}

/** 投票通知タップ後に着地するべき投票結果画面の URL */
export function voteResultScreenPath(shareToken: string = MOCK_VOTE_NOTIFICATION_SHARE_TOKEN): string {
	return `/ja-JP/search/dish-category-group-votes/${shareToken}`;
}

/**
 * GRP-04 の投票完了通知を 1 件組み立てる。
 *
 * `dishCategoryGroupVoteSession` は #1506 で追加したフィールドで、
 * **これが undefined だと画面側の分岐が成立せず遷移しない**（index.tsx の `handleNotificationPress`）。
 * つまりこのフィールドを落とす回帰は「押しても何も起きない」として検出される。
 */
export function buildVoteNotification(): NotificationItem {
	const now = "2026-01-01T00:00:00.000Z";
	return {
		notification: {
			id: "00000000-0000-4000-8000-0000000015a0",
			action_type: "vote",
			target_table: "dish_category_group_vote_sessions",
			target_id: MOCK_VOTE_NOTIFICATION_SESSION_ID,
			actor_ids: ["00000000-0000-4000-8000-0000000015b0"],
			idempotency_key: `dish_category_group_vote_sessions:vote:${MOCK_VOTE_NOTIFICATION_SESSION_ID}`,
			created_at: now,
			updated_at: now,
		},
		actors: [
			{
				id: "00000000-0000-4000-8000-0000000015b0",
				display_name: MOCK_VOTE_ACTOR_NAME,
				avatarUrls: { sm: "https://example.invalid/e2e-1506-sm.jpg", md: "https://example.invalid/e2e-1506-md.jpg" },
			} as NotificationItem["actors"][number],
		],
		dishCategoryGroupVoteSession: {
			id: MOCK_VOTE_NOTIFICATION_SESSION_ID,
			shareToken: MOCK_VOTE_NOTIFICATION_SHARE_TOKEN,
		},
	};
}

/**
 * 比較対象として置く、既存種別（dish_media への like）の通知。
 *
 * 「vote 通知だけを返す」モックだと、行が 1 件しか無いために
 * *どの種別でも* 同じ行が引けてしまい、種別ごとの出し分け（アイコン・文言・遷移先）を
 * 検証したことにならない。混ぜておくことで `notification-item-vote` が
 * **vote の行だけ**を指していることまで保証できる。
 */
export function buildLikeNotification(): NotificationItem {
	const now = "2025-12-31T00:00:00.000Z";
	return {
		notification: {
			id: "00000000-0000-4000-8000-0000000015c0",
			action_type: "like",
			target_table: "dish_media",
			target_id: "00000000-0000-4000-8000-0000000015d0",
			actor_ids: ["00000000-0000-4000-8000-0000000015e0"],
			idempotency_key: "dish_media:like:00000000-0000-4000-8000-0000000015d0",
			created_at: now,
			updated_at: now,
		},
		actors: [
			{
				id: "00000000-0000-4000-8000-0000000015e0",
				display_name: "いいねした人",
				avatarUrls: {
					sm: "https://example.invalid/e2e-1506-like.jpg",
					md: "https://example.invalid/e2e-1506-like.jpg",
				},
			} as NotificationItem["actors"][number],
		],
		// dishMediaEntries を敢えて付けない = この行は押しても遷移しない。
		// 「vote の行を押したから遷移した」と言い切れるようにするため
	};
}

/**
 * 通知系 3 エンドポイントをまとめてモックに差し替える。
 *
 * @param page 対象ページ（`goto` より前に呼ぶこと）
 * @param items 一覧が返す通知。先頭が画面の最上段に来る
 */
export async function mockNotifications(page: Page, items: NotificationItem[]): Promise<void> {
	// ⚠️ Playwright の route は **後に登録したものが先に評価される**。
	// 一覧のパターンは末尾を閉じてあるので衝突しないが、順序に依存しない形にしておく
	await page.route(LIST_URL_PATTERN, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true, data: { data: items, nextCursor: null } }),
		});
	});

	await page.route(UNREAD_COUNT_URL_PATTERN, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true, data: { unread: items.length } }),
		});
	});

	// 実 API へ流すと dev DB の既読状態が書き変わる（不可逆）。必ず握りつぶす
	await page.route(MARK_ALL_READ_URL_PATTERN, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ success: true, data: { lastReadAt: new Date().toISOString() } }),
		});
	});
}
