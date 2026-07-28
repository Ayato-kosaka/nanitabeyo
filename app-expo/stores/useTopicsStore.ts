import i18n from "@/lib/i18n";
import type { SupabaseDishCategories } from "@shared/converters/convert_dish_categories";
import { createWithEqualityFn } from "zustand/traditional";

// #472 【設計】保存トピック（DishCategory）を正規化してストア管理
export type DishCategory = Pick<SupabaseDishCategories, "id" | "image_url" | "labels" | "label_en">;

/**
 * 保存トピック（dish_categories）に関する正規化済みの状態を管理するストア。
 *
 * - topicById: topic.id をキーにした正規化テーブル（唯一のソース・オブ・トゥルース）
 * - topicIdsByKey: 画面用途キーごとの並び順（プロフィールの保存済みトピックなど）
 * - isLoadingByKey / errorByKey: 画面用途キーごとの読み込み・エラー状態
 *
 * フェッチ処理自体はコンポーネントやサービス側で行い、
 * 本ストアは「正規化されたデータ」と「画面用途キーごとの状態」のみを扱う。
 */
export type TopicsStore = {
	// ------ 内部状態（直接参照せず、セレクタ経由で読むことを推奨） ------

	/**
	 * topic.id をキーにした正規化済み DishCategory のマップ。
	 * ここがトピック情報の唯一のソース・オブ・トゥルース。
	 */
	topicById: Record<string, DishCategory>;

	/**
	 * 画面用途キー（例: "profileSavedTopics"）ごとの topic.id の配列。
	 * 並び順の管理のみを担当し、実体は topicById を参照する。
	 */
	topicIdsByKey: Record<string, string[]>;

	/**
	 * 画面用途キーごとのロード状態。
	 */
	isLoadingByKey: Record<string, boolean>;

	/**
	 * 画面用途キーごとのエラーメッセージ。
	 */
	errorByKey: Record<string, string | null>;

	/**
	 * 画面用途キーごとに初回取得が完了したかどうかを管理するフラグ。
	 */
	hasFetchedInitialByKey: Record<string, boolean>;

	/**
	 * カーソルページネーション用の nextCursor を画面用途キーごとに管理
	 */
	nextCursorByKey: Record<string, string | null>;

	/**
	 * 追加ページ取得中かどうかを画面用途キーごとに管理
	 */
	isLoadingMoreByKey: Record<string, boolean>;

	/**
	 * #1007 【設計】検索結果カード（Topic）単位の保存状態。topicById は「保存済みトピック一覧」用の
	 * 正規化データ（DishCategory型）であるのに対し、こちらは検索結果カード（Topic型）が参照する
	 * 保存フラグのみを topic.categoryId をキーに持つ別枠のスライス。
	 */
	savedByTopicId: Record<string, boolean>;

	// ------ public 挿入・更新メソッド（同期） ------

	/**
	 * DishCategory 配列を正規化して topicById を更新する。
	 * 並び順（topicIdsByKey）には触れない。
	 */
	upsertTopics: (items: DishCategory[]) => void;

	/**
	 * 指定キーの topicId 配列を更新する（並び順専用）。
	 */
	updateTopicIdsByKey: (key: string, updater: (prevIds: string[]) => string[]) => void;

	/**
	 * 指定した DishCategory（topic.id）をピンポイントに更新する。
	 */
	updateTopic: (topicId: string, topicUpdater: (topic: DishCategory) => DishCategory) => void;

	/**
	 * #1007 【設計】検索結果カード（Topic）の保存状態を更新する。TopicCard はこの値を購読し、
	 * カード再利用（Carousel の key 撤去）後もカテゴリ単位で保存状態を維持する。
	 */
	setTopicSaved: (topicId: string, isSaved: boolean) => void;

	// ------ public 挿入・更新メソッド（非同期ラッパー） ------

	/**
	 * 非同期に取得した topicId 配列で指定キーの topicIdsByKey を更新する。
	 */
	updateTopicIdsByKeyAsync: (
		key: string,
		idsPromise: Promise<string[]>,
		updater: (prevIds: string[], fetchedIds: string[]) => string[],
	) => Promise<void>;

	// ------ public 削除メソッド ------

	/**
	 * 画面用途キーごとのエントリと状態をクリアする。
	 *
	 * - key を指定した場合:
	 *   - 該当 key の topicIdsByKey / isLoadingByKey / errorByKey を削除
	 *   - 他の key から参照されなくなった topicById の要素もクリーンアップ
	 *
	 * - key を省略した場合:
	 *   - 全てのキーと状態をクリア（完全リセット）
	 */
	clearByKey: (key?: string) => void;

	// ------ カーソルページネーション API ------

	/**
	 * 初期取得 + store への反映
	 */
	fetchInitialByKey: <TReq>(
		key: string,
		request: TReq,
		fetcher: (params: { cursor?: string | null; request?: TReq }) => Promise<{
			data: DishCategory[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;

	/**
	 * 追加ページ取得 + store への追記
	 */
	fetchMoreByKey: <TReq>(
		key: string,
		request: TReq | undefined,
		fetcher: (params: { cursor?: string | null; request?: TReq }) => Promise<{
			data: DishCategory[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;
};

/**
 * 画面用途キーごとの id 配列を取得するセレクタ。
 * - ids: topic.id の配列（デフォルト 空配列）
 * - isLoading: 当該キーのロード中フラグ（デフォルト false）
 * - error: 当該キーのエラー（デフォルト null）
 * - hasNextPage: 次ページがあるかどうか（デフォルト false）
 * - isLoadingMore: 追加ページ取得中かどうか（デフォルト false）
 */
export const selectTopicIdsByKey =
	(key: string) =>
	(
		state: TopicsStore,
	): {
		ids: string[];
		isLoading: boolean;
		error: string | null;
		hasFetchedInitial: boolean;
		hasNextPage: boolean;
		isLoadingMore: boolean;
	} => {
		return {
			ids: state.topicIdsByKey[key] ?? [],
			isLoading: state.isLoadingByKey[key] ?? false,
			error: state.errorByKey[key] ?? null,
			hasFetchedInitial: state.hasFetchedInitialByKey[key] ?? false,
			hasNextPage: (state.nextCursorByKey[key] ?? null) !== null,
			isLoadingMore: state.isLoadingMoreByKey[key] ?? false,
		};
	};

/**
 * topic.id から正規化済み DishCategory を取得するセレクタ。
 */
export const selectTopicById =
	(topicId: string) =>
	(state: TopicsStore): DishCategory | null =>
		state.topicById[topicId] ?? null;

/**
 * #1007 【設計】検索結果カード（Topic）の保存状態を取得するセレクタ。
 * store未登録時は呼び出し元が渡す fallback（サーバから受け取った item.isSaved 等）を採用する。
 */
export const selectIsTopicSaved =
	(topicId: string, fallback: boolean) =>
	(state: TopicsStore): boolean =>
		state.savedByTopicId[topicId] ?? fallback;

export const useTopicsStore = createWithEqualityFn<TopicsStore>()((set, get) => ({
	// ------ 初期状態 ------

	topicById: {},
	topicIdsByKey: {},
	isLoadingByKey: {},
	errorByKey: {},
	hasFetchedInitialByKey: {},
	nextCursorByKey: {},
	isLoadingMoreByKey: {},
	savedByTopicId: {},

	// ------ 同期挿入・更新メソッド ------

	upsertTopics: (items) =>
		set((state) => {
			if (!items.length) return state;
			const topicPatch: Record<string, DishCategory> = {};

			for (const item of items) {
				const topicId = item.id;
				topicPatch[topicId] = item;
			}

			return {
				topicById: {
					...state.topicById,
					...topicPatch,
				},
			};
		}),

	updateTopicIdsByKey: (key, updater) =>
		set((state) => {
			const prevIds = state.topicIdsByKey[key] ?? [];
			const nextIds = updater(prevIds);
			return {
				topicIdsByKey: {
					...state.topicIdsByKey,
					[key]: nextIds,
				},
			};
		}),

	updateTopic: (topicId, topicUpdater) =>
		set((state) => {
			return state.topicById[topicId] === undefined
				? state
				: {
						topicById: {
							...state.topicById,
							[topicId]: topicUpdater(state.topicById[topicId]),
						},
					};
		}),

	setTopicSaved: (topicId, isSaved) =>
		set((state) =>
			state.savedByTopicId[topicId] === isSaved
				? state
				: { savedByTopicId: { ...state.savedByTopicId, [topicId]: isSaved } },
		),

	// ------ 非同期挿入・更新メソッド ------

	updateTopicIdsByKeyAsync: async (key, promise, updater) =>
		handleAsyncAction(set, key, promise, (fetchedIds) =>
			get().updateTopicIdsByKey(key, (prevIds) => updater(prevIds, fetchedIds)),
		),

	// ------ 削除メソッド ------

	clearByKey: (key) =>
		set((state) => {
			// key 未指定 → 全リセット
			if (!key) {
				return {
					topicById: {},
					topicIdsByKey: {},
					isLoadingByKey: {},
					errorByKey: {},
					hasFetchedInitialByKey: {},
					nextCursorByKey: {},
					isLoadingMoreByKey: {},
				};
			}

			// 該当キーを削除した topicIdsByKey / isLoadingByKey / errorByKey を作成
			const nextTopicIdsByKey = { ...state.topicIdsByKey };
			const nextIsLoadingByKey = { ...state.isLoadingByKey };
			const nextErrorByKey = { ...state.errorByKey };
			const nextHasFetchedInitialByKey = { ...state.hasFetchedInitialByKey };
			const nextNextCursorByKey = { ...state.nextCursorByKey };
			const nextIsLoadingMoreByKey = { ...state.isLoadingMoreByKey };

			delete nextTopicIdsByKey[key];
			delete nextIsLoadingByKey[key];
			delete nextErrorByKey[key];
			delete nextHasFetchedInitialByKey[key];
			delete nextNextCursorByKey[key];
			delete nextIsLoadingMoreByKey[key];

			// 残っているキーから参照されている topicId のみを topicById に残す
			const remainingTopicIds = new Set<string>();
			for (const ids of Object.values(nextTopicIdsByKey)) {
				for (const id of ids) {
					remainingTopicIds.add(id);
				}
			}

			// topicById をクリーンアップ
			const nextTopicById: Record<string, DishCategory> = {};
			for (const id of remainingTopicIds) {
				const topic = state.topicById[id];
				if (topic) {
					nextTopicById[id] = topic;
				}
			}

			return {
				topicById: nextTopicById,
				topicIdsByKey: nextTopicIdsByKey,
				isLoadingByKey: nextIsLoadingByKey,
				errorByKey: nextErrorByKey,
				hasFetchedInitialByKey: nextHasFetchedInitialByKey,
				nextCursorByKey: nextNextCursorByKey,
				isLoadingMoreByKey: nextIsLoadingMoreByKey,
			};
		}),

	// ------ カーソルページネーション API の実装 ------

	fetchInitialByKey: (key, request, fetcher) =>
		handleAsyncAction(set, key, fetcher({ request }), (response) => {
			const { clearByKey, upsertTopics, updateTopicIdsByKey } = get();
			// topicIdsByKey[key] を初期化してから新規データを反映
			clearByKey(key);

			// 1. エンティティを正規化して反映
			upsertTopics(response.data);

			// 2. 並び順を id でセット
			const topicIds = response.data.map((item) => item.id);
			updateTopicIdsByKey(key, () => topicIds);

			// 3. nextCursor / hasFetchedInitial の更新
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
				hasFetchedInitialByKey: { ...state.hasFetchedInitialByKey, [key]: true },
			}));
		}),

	fetchMoreByKey: async (key, request, fetcher) => {
		const { nextCursorByKey, upsertTopics, updateTopicIdsByKey } = get();
		const nextCursor = nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		return handleAsyncAction(
			set,
			key,
			fetcher({ cursor: nextCursor, request }),
			(response) => {
				// 1. エンティティを正規化
				upsertTopics(response.data);

				// 2. 並び順の末尾に追加
				const topicIds = response.data.map((item) => item.id);
				updateTopicIdsByKey(key, (prevIds) => {
					// #CodeQL 【パフォーマンス】重複ID排除を Set で高速化（O(1)ルックアップ）
					const prevIdSet = new Set(prevIds);
					const newIds = topicIds.filter((id) => !prevIdSet.has(id));
					return [...prevIds, ...newIds];
				});

				// 3. nextCursorByKey[key] を更新
				set((prevState) => ({
					nextCursorByKey: { ...prevState.nextCursorByKey, [key]: response.nextCursor ?? null },
				}));
			},
			{ loadingType: "isLoadingMoreByKey" },
		);
	},
}));

// ------ 非同期挿入ヘルパー ------
const handleAsyncAction = <T>(
	set: (partial: Partial<TopicsStore> | ((state: TopicsStore) => Partial<TopicsStore>)) => void,
	key: string,
	promise: Promise<T>,
	onSuccess: (response: T) => void | Promise<void>,
	option?: { loadingType?: keyof Pick<TopicsStore, "isLoadingByKey" | "isLoadingMoreByKey"> },
) => {
	const { loadingType = "isLoadingByKey" } = option || {};
	// ローディング開始 & エラーリセット
	set((state) => ({
		[loadingType]: { ...state[loadingType], [key]: true },
		errorByKey: { ...state.errorByKey, [key]: null },
	}));

	return promise
		.then(async (items) => {
			await onSuccess(items);
		})
		.catch((err) => {
			const errorMessage = err ? (err instanceof Error ? err.message : String(err)) : null;
			set((state) => ({
				errorByKey: {
					...state.errorByKey,
					[key]: i18n.t("Profile.tabError.failedToLoad", { error: errorMessage }),
				},
			}));
		})
		.finally(() => {
			set((state) => ({
				[loadingType]: { ...state[loadingType], [key]: false },
			}));
		});
};
