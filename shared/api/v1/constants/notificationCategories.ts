/**
 * 🔔 通知カテゴリの共有定義（#1510 SET-02）。
 *
 * API（プッシュ送信可否の判定）と app-expo（設定画面のトグル）が **この 1 ファイルだけ**を見る。
 * DB には `user_notification_preferences.category` としてこの key がそのまま入る。
 *
 * ## 二層構造にしている理由（リーダー判断 §1）
 * 内部の通知種別は `(target_table, action_type)` の組で運用されている
 * （`notifications` テーブル、`idempotency_key` の `${target}:${action}:${id}` 形式）。
 * これをそのままトグルに出すと「投稿へのいいね」「レビューへのいいね」が別々の行になり、
 * 種別が増えるたびに設定画面の項目だけが増えていく。ユーザーから見て
 * 「何が届かなくなるか」を説明できる粒度は **カテゴリ** なので、組 → カテゴリの
 * 対応表をここに置き、UI はカテゴリ単位で操作する。
 *
 * ## カテゴリを追加するときの手順
 * 1. `NOTIFICATION_CATEGORIES` に key を足す（DB の migration は不要。`category` は text で CHECK が無い）
 * 2. `NOTIFICATION_CATEGORY_DEFINITIONS` に `defaultEnabled` と対象の組を書く
 * 3. `app-expo/locales/*.json` 8 ファイルへ `Settings.notifications.<category>.title` / `.description` を足す
 */

/**
 * ユーザーに見せる通知カテゴリ。**表示名はここに持たない**（i18n 側が正）。
 *
 * 値は DB・API・i18n キーで共通の snake_case。順序はそのまま設定画面の並び順になる。
 */
export const NOTIFICATION_CATEGORIES = ["likes", "saves", "group_votes"] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** 通知種別（`notifications.target_table` × `notifications.action_type`）の組 */
export interface NotificationKind {
	targetTable: string;
	actionType: string;
}

export interface NotificationCategoryDefinition {
	/** DB / API / i18n で共通の key */
	category: NotificationCategory;
	/**
	 * `user_notification_preferences` に行が無いときの値（リーダー判断 §3: 現行は全カテゴリ true）。
	 *
	 * 既定オンにしている根拠は「このアプリの通知はいずれもユーザー自身の投稿・自身が参加した
	 * グループに紐づく反応であり、無関係な販促通知ではない」こと。既定オフにすると、
	 * 設定画面に辿り着かないユーザーには通知機能が存在しないのと同じになる。
	 */
	defaultEnabled: boolean;
	/** このカテゴリに束ねる通知種別 */
	kinds: readonly NotificationKind[];
}

/**
 * カテゴリ定義の実体。
 *
 * ⚠️ `kinds` に載っていない組が来た場合は **送信する**（後述の `resolveNotificationCategory` が
 * `null` を返し、呼び出し側は既定オン扱いにする）。開発者が対応表への追加を忘れても
 * 通知が黙って消えないほうが被害が小さい。
 */
export const NOTIFICATION_CATEGORY_DEFINITIONS: readonly NotificationCategoryDefinition[] = [
	{
		category: "likes",
		defaultEnabled: true,
		kinds: [
			// api/src/v1/dish-media/dish-media.service.ts の reaction 経由
			{ targetTable: "dish_media", actionType: "like" },
			// api/src/v1/dish-reviews/dish-reviews.service.ts の like 経由
			{ targetTable: "dish_reviews", actionType: "like" },
		],
	},
	{
		category: "saves",
		defaultEnabled: true,
		kinds: [{ targetTable: "dish_media", actionType: "save" }],
	},
	{
		category: "group_votes",
		defaultEnabled: true,
		// #1506（GRP-04）で実装される投票の通知。組の名前が確定したらここへ足すだけで
		// この仕組みに乗る（Issue #1510 の完了条件）。
		kinds: [{ targetTable: "dish_category_group_vote_sessions", actionType: "vote" }],
	},
] as const;

/** key からカテゴリ定義を引く */
export function getNotificationCategoryDefinition(
	category: string,
): NotificationCategoryDefinition | undefined {
	return NOTIFICATION_CATEGORY_DEFINITIONS.find((definition) => definition.category === category);
}

/** 与えられた文字列が既知のカテゴリ key か */
export function isNotificationCategory(value: string): value is NotificationCategory {
	return NOTIFICATION_CATEGORIES.includes(value as NotificationCategory);
}

/**
 * 通知種別の組からカテゴリを解決する。
 *
 * 対応表に無い組では `null` を返す。**呼び出し側はこれを「抑止対象ではない」= 送信する、
 * として扱うこと。** 新種別の追加時に対応表への登録を忘れても通知が消えないようにするため。
 */
export function resolveNotificationCategory(
	kind: NotificationKind,
): NotificationCategory | null {
	const definition = NOTIFICATION_CATEGORY_DEFINITIONS.find((candidate) =>
		candidate.kinds.some(
			(entry) => entry.targetTable === kind.targetTable && entry.actionType === kind.actionType,
		),
	);
	return definition?.category ?? null;
}

/** カテゴリの既定値（未設定時の値）。未知のカテゴリは安全側（オン）に倒す */
export function getNotificationCategoryDefault(category: string): boolean {
	return getNotificationCategoryDefinition(category)?.defaultEnabled ?? true;
}
