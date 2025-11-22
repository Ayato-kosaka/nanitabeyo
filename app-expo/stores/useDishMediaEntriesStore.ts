import i18n from "@/lib/i18n";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { createWithEqualityFn } from "zustand/traditional";

// #457 【設計】レビュー単体の型定義
export type DishReview = DishMediaEntry["dish_reviews"][number];

// #457 【設計】正規化した料理メディアエントリ型（dish_reviews を dishReviewIds に置き換え）
export type NormalizedDishMediaEntry = Omit<DishMediaEntry, "dish_reviews"> & {
	dishReviewIds: string[];
};

/**
 * 料理メディア（dish_media）に関する正規化済みの状態を管理するストア。
 *
 * - entriesByMediaId: dish_media.id をキーにした正規化テーブル（唯一のソース・オブ・トゥルース）
 * - reviewsByReviewId: 全ユーザーのレビューを正規化したテーブル
 * - mediaIdsByKey: 画面用途キーごとの並び順（feed / 検索結果 / プロフィールなど）
 * - myReviewIdsByKey: 自分のレビュー一覧用の reviewId 配列
 * - isLoadingByKey / errorByKey: 画面用途キーごとの読み込み・エラー状態
 *
 * フェッチ処理自体はコンポーネントやサービス側で行い、
 * 本ストアは「正規化されたデータ」と「画面用途キーごとの状態」のみを扱う。
 */
export type DishMediaEntriesStore = {
	// ------ 内部状態（直接参照せず、セレクタ経由で読むことを推奨） ------

	/**
	 * dish_media.id をキーにした正規化済み DishMediaEntry のマップ。
	 * ここが料理メディア情報の唯一のソース・オブ・トゥルース。
	 */
	entriesByMediaId: Record<string, NormalizedDishMediaEntry>;

	/**
	 * 画面用途キー（例: "map", "liked"）ごとの dish_media.id の配列。
	 * 並び順の管理のみを担当し、実体は entriesByMediaId を参照する。
	 */
	mediaIdsByKey: Record<string, string[]>;

	/**
	 * dish_review.id をキーにした全ユーザーの dish_reviews エントリのマップ。
	 * レビュー情報の唯一のソース・オブ・トゥルース。
	 */
	reviewsByReviewId: Record<string, DishReview>;

	/**
	 * reviews キーの画面用途に対応する dish_review.id の配列（並び順管理用）。
	 */
	myReviewIdsByKey: Record<"reviews", string[]>;

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
	 *カーソルページネーション用の nextCursor を画面用途キーごとに管理
	 */
	nextCursorByKey: Record<string, string | null>;

	/**
	 * 追加ページ取得中かどうかを画面用途キーごとに管理
	 */
	isLoadingMoreByKey: Record<string, boolean>;

	// ------ public 挿入・更新メソッド（同期） ------

	/**
	 * 指定した画面用途キーの末尾に DishMediaEntry を追加する。
	 * entriesByMediaId を更新しつつ、mediaIdsByKey[key] の末尾に mediaId を追加する。
	 * 既に同じ mediaId が存在する場合は、エントリは上書きする。
	 */
	pushEntriesByKey: (key: string, items: DishMediaEntry[]) => void;

	/**
	 * 指定した画面用途キーの先頭に DishMediaEntry を追加する。
	 * entriesByMediaId を更新しつつ、mediaIdsByKey[key] の先頭に mediaId を追加する。
	 * 既に同じ mediaId が存在する場合は、エントリは上書きする。
	 */
	unshiftEntriesByKey: (key: string, items: DishMediaEntry[]) => void;

	/**
	 * 指定した画面用途キーの末尾に DishMediaEntry の dish_reviews を追加する。
	 * reviewsByReviewId を更新しつつ、reviewIdsByKey[key] の末尾に reviewId を追加する。
	 * 既に同じ reviewId が存在する場合は、エントリは上書きする。
	 */
	pushEntriesWithMyReviewsByKey: (key: "reviews", items: DishMediaEntry[]) => void;

	/**
	 * 指定した画面用途キーの先頭に DishMediaEntry の dish_reviews を追加する。
	 * reviewsByReviewId を更新しつつ、reviewIdsByKey[key] の先頭に reviewId を追加する。
	 * 既に同じ reviewId が存在する場合は、エントリは上書きする。
	 */
	unshiftEntriesWithMyReviewsByKey: (key: "reviews", items: DishMediaEntry[]) => void;

	/**
	 * 指定した DishMediaEntry（dish_media.id）をピンポイントに更新する。
	 */
	updateEntry: (
		dishMediaId: string,
		entryUpdater: (entry: NormalizedDishMediaEntry) => NormalizedDishMediaEntry,
	) => void;

	/**
	 * 指定した DishReview（dish_review.id）をピンポイントに更新する。
	 */
	updateReview: (dishReviewId: string, reviewUpdater: (review: DishReview) => DishReview) => void;

	// ------ public 挿入メソッド（非同期ラッパー） ------

	/**
	 * Promise を受け取り、共通的に loading / error / データ反映を行うヘルパー。
	 * 成功時は pushEntriesByKey を利用して末尾に追加する。
	 */
	pushEntriesByKeyAsync: (key: string, itemsPromise: Promise<DishMediaEntry[]>) => void;

	/**
	 * Promise を受け取り、共通的に loading / error / データ反映を行うヘルパー。
	 * 成功時は unshiftEntriesByKey を利用して先頭に追加する。
	 */
	unshiftEntriesByKeyAsync: (key: string, itemsPromise: Promise<DishMediaEntry[]>) => void;

	/**
	 * Promise を受け取り、共通的に loading / error / データ反映を行うヘルパー。
	 * 成功時は pushEntriesWithMyReviewsByKey を利用して末尾に追加する。
	 */
	pushEntriesWithMyReviewsByKeyAsync: (key: "reviews", itemsPromise: Promise<DishMediaEntry[]>) => void;

	/**
	 * Promise を受け取り、共通的に loading / error / データ反映を行うヘルパー。
	 * 成功時は unshiftEntriesWithMyReviewsByKey を利用して先頭に追加する。
	 */
	unshiftEntriesWithMyReviewsByKeyAsync: (key: "reviews", itemsPromise: Promise<DishMediaEntry[]>) => void;

	// ------ public 削除メソッド ------

	/**
	 * 画面用途キーごとのエントリと状態をクリアする。
	 *
	 * - key を指定した場合:
	 *   - 該当 key の mediaIdsByKey / isLoadingByKey / errorByKey を削除
	 *   - 他の key から参照されなくなった entriesByMediaId の要素もクリーンアップ
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
			data: DishMediaEntry[];
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
			data: DishMediaEntry[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;

	/**
	 * 初期取得 + store への反映（レビュー用）
	 */
	fetchInitialWithMyReviewsByKey: <TReq>(
		key: "reviews",
		request: TReq,
		fetcher: (params: { cursor?: string | null; request?: TReq }) => Promise<{
			data: DishMediaEntry[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;

	/**
	 * 追加ページ取得 + store への追記（レビュー用）
	 */
	fetchMoreWithMyReviewsByKey: <TReq>(
		key: "reviews",
		request: TReq | undefined,
		fetcher: (params: { cursor?: string | null; request?: TReq }) => Promise<{
			data: DishMediaEntry[];
			nextCursor?: string | null;
		}>,
	) => Promise<void>;
};

/**
 * 画面用途キーごとの id 配列を取得するセレクタ。
 * - ids: dish_media.id または dish_review.id の配列（デフォルト 空配列）
 * - isLoading: 当該キーのロード中フラグ（デフォルト false）
 * - error: 当該キーのエラー（デフォルト null）
 * - hasNextPage: 次ページがあるかどうか（デフォルト false）
 * - isLoadingMore: 追加ページ取得中かどうか（デフォルト false）
 */
export const selectIdsByKey =
	(key: string) =>
	(
		state: DishMediaEntriesStore,
	): {
		ids: string[];
		isLoading: boolean;
		error: string | null;
		hasFetchedInitial: boolean;
		hasNextPage: boolean;
		isLoadingMore: boolean;
	} => {
		const ids = (key === "reviews" ? state.myReviewIdsByKey[key] : state.mediaIdsByKey[key]) || [];
		return {
			ids,
			isLoading: state.isLoadingByKey[key] ?? false,
			error: state.errorByKey[key] ?? null,
			hasFetchedInitial: state.hasFetchedInitialByKey[key] ?? false,
			hasNextPage: (state.nextCursorByKey[key] ?? null) !== null,
			isLoadingMore: state.isLoadingMoreByKey[key] ?? false,
		};
	};

/**
 * id, key から正規化済み DishMediaEntry を取得するセレクタ。
 * レビュー情報が必要な場合は selectReviewById や selectReviewsForEntry を併用する。
 */
export const selectEntryById =
	(id: string, option?: { key?: string }) =>
	(state: DishMediaEntriesStore): NormalizedDishMediaEntry | null => {
		const { key } = option || {};
		if (key === "reviews") {
			const review = state.reviewsByReviewId[id];
			if (!review) return null;
			const mediaId = String(review.created_dish_media_id);
			return state.entriesByMediaId[mediaId] ?? null;
		}
		return state.entriesByMediaId[id] ?? null;
	};

/**
 * id, key  から正規化済み  DishReview[] を取得するセレクタ。
 */
export const selectReviewsByReviewId =
	(id: string, option?: { key?: string }) =>
	(state: DishMediaEntriesStore): DishReview[] => {
		const { key } = option || {};
		if (key === "reviews") return state.reviewsByReviewId[id] ? [state.reviewsByReviewId[id]] : [];
		const entry = selectEntryById(id, option)(state);
		if (!entry) return [];
		return entry.dishReviewIds.map((reviewId) => state.reviewsByReviewId[reviewId]).filter((r): r is DishReview => !!r);
	};

/**
 * dish_media.id に紐づく全レビューを取得するセレクタ。
 */
export const selectReviewsForEntry =
	(mediaId: string) =>
	(state: DishMediaEntriesStore): DishReview[] => {
		const entry = state.entriesByMediaId[mediaId];
		if (!entry) return [];
		return entry.dishReviewIds.map((id) => state.reviewsByReviewId[id]).filter((r): r is DishReview => !!r);
	};

export const useDishMediaEntriesStore = createWithEqualityFn<DishMediaEntriesStore>()((set, get) => ({
	// ------ 初期状態 ------

	entriesByMediaId: {},
	mediaIdsByKey: {},
	reviewsByReviewId: {},
	myReviewIdsByKey: { reviews: [] },
	isLoadingByKey: {},
	errorByKey: {},
	hasFetchedInitialByKey: {},
	nextCursorByKey: {},
	isLoadingMoreByKey: {},

	// ------ 同期挿入メソッド ------

	pushEntriesByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;
			const { nextEntriesById, nextReviewsById, addedMediaIds } = normalizeDishMediaItems(state, items);
			const prevIds = state.mediaIdsByKey[key] ?? [];
			return {
				entriesByMediaId: nextEntriesById,
				reviewsByReviewId: nextReviewsById,
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: [...prevIds, ...addedMediaIds],
				},
			};
		}),

	unshiftEntriesByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;
			const { nextEntriesById, nextReviewsById, addedMediaIds } = normalizeDishMediaItems(state, items);
			const prevIds = state.mediaIdsByKey[key] ?? [];
			return {
				entriesByMediaId: nextEntriesById,
				reviewsByReviewId: nextReviewsById,
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: [...addedMediaIds, ...prevIds],
				},
			};
		}),

	pushEntriesWithMyReviewsByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;
			const { nextEntriesById, nextReviewsById, addedMyReviewIds } = normalizeDishMediaItems(state, items);
			const prevIds = state.myReviewIdsByKey[key] ?? [];
			return {
				entriesByMediaId: nextEntriesById,
				reviewsByReviewId: nextReviewsById,
				myReviewIdsByKey: {
					...state.myReviewIdsByKey,
					[key]: [...prevIds, ...addedMyReviewIds],
				},
			};
		}),

	unshiftEntriesWithMyReviewsByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;
			const { nextEntriesById, nextReviewsById, addedMyReviewIds } = normalizeDishMediaItems(state, items);
			const prevIds = state.myReviewIdsByKey[key] ?? [];
			return {
				entriesByMediaId: nextEntriesById,
				reviewsByReviewId: nextReviewsById,
				myReviewIdsByKey: {
					...state.myReviewIdsByKey,
					[key]: [...addedMyReviewIds, ...prevIds],
				},
			};
		}),

	updateEntry: (dishMediaId, entryUpdater) =>
		set((state) => {
			return state.entriesByMediaId[dishMediaId] === undefined
				? state
				: {
						entriesByMediaId: {
							...state.entriesByMediaId,
							[dishMediaId]: entryUpdater(state.entriesByMediaId[dishMediaId]),
						},
					};
		}),

	updateReview: (dishReviewId, reviewUpdater) =>
		set((state) => {
			return state.reviewsByReviewId[dishReviewId] === undefined
				? state
				: {
						reviewsByReviewId: {
							...state.reviewsByReviewId,
							[dishReviewId]: reviewUpdater(state.reviewsByReviewId[dishReviewId]),
						},
					};
		}),

	// ------ 非同期ラッパーメソッド ------

	pushEntriesByKeyAsync: (key, itemsPromise) =>
		handleAsyncAction(set, key, itemsPromise, (items) => get().pushEntriesByKey(key, items)),

	unshiftEntriesByKeyAsync: (key, itemsPromise) =>
		handleAsyncAction(set, key, itemsPromise, (items) => get().unshiftEntriesByKey(key, items)),

	pushEntriesWithMyReviewsByKeyAsync: (key, itemsPromise) =>
		handleAsyncAction(set, key, itemsPromise, (items) => get().pushEntriesWithMyReviewsByKey(key, items)),

	unshiftEntriesWithMyReviewsByKeyAsync: (key, itemsPromise) =>
		handleAsyncAction(set, key, itemsPromise, (items) => get().unshiftEntriesWithMyReviewsByKey(key, items)),

	// ------ 削除メソッド ------

	clearByKey: (key) =>
		set((state) => {
			// key 未指定 → 全リセット
			if (!key) {
				return {
					entriesByMediaId: {},
					mediaIdsByKey: {},
					reviewsByReviewId: {},
					myReviewIdsByKey: { reviews: [] },
					isLoadingByKey: {},
					errorByKey: {},
					hasFetchedInitialByKey: {},
					nextCursorByKey: {},
					isLoadingMoreByKey: {},
				};
			}

			// 該当キーを削除した mediaIdsByKey / myReviewIdsByKey / isLoadingByKey / errorByKey を作成
			const nextMediaIdsByKey = { ...state.mediaIdsByKey };
			const nextMyReviewIdsByKey = { ...state.myReviewIdsByKey };
			const nextIsLoadingByKey = { ...state.isLoadingByKey };
			const nextErrorByKey = { ...state.errorByKey };
			const nextHasFetchedInitialByKey = { ...state.hasFetchedInitialByKey };
			const nextNextCursorByKey = { ...state.nextCursorByKey };
			const nextIsLoadingMoreByKey = { ...state.isLoadingMoreByKey };

			delete nextMediaIdsByKey[key];
			delete nextIsLoadingByKey[key];
			delete nextErrorByKey[key];
			delete nextHasFetchedInitialByKey[key];
			delete nextNextCursorByKey[key];
			delete nextIsLoadingMoreByKey[key];

			if (key === "reviews") {
				nextMyReviewIdsByKey.reviews = [];
			}

			// 残っているキーから参照されている mediaId のみを entriesByMediaId に残す
			const remainingMediaIds = new Set<string>();
			for (const ids of Object.values(nextMediaIdsByKey)) {
				for (const id of ids) {
					remainingMediaIds.add(id);
				}
			}

			// reviews 側から参照されている mediaId も残す
			for (const reviewId of nextMyReviewIdsByKey.reviews) {
				const review = state.reviewsByReviewId[reviewId];
				if (review) {
					remainingMediaIds.add(String(review.created_dish_media_id));
				}
			}

			// entriesByMediaId をクリーンアップ
			const nextEntriesById: Record<string, NormalizedDishMediaEntry> = {};
			for (const id of remainingMediaIds) {
				const entry = state.entriesByMediaId[id];
				if (entry) {
					nextEntriesById[id] = entry;
				}
			}

			// #457 【設計】reviewsByReviewId をクリーンアップ（参照されているもののみ残す）
			const remainingReviewIds = new Set<string>();
			// myReviewIdsByKey.reviews から参照されているレビュー
			for (const id of nextMyReviewIdsByKey.reviews) {
				remainingReviewIds.add(id);
			}
			// entriesByMediaId から参照されているレビュー
			for (const entry of Object.values(nextEntriesById)) {
				for (const reviewId of entry.dishReviewIds) {
					remainingReviewIds.add(reviewId);
				}
			}

			const nextReviewsByReviewId: Record<string, DishReview> = {};
			for (const id of remainingReviewIds) {
				const review = state.reviewsByReviewId[id];
				if (review) nextReviewsByReviewId[id] = review;
			}

			return {
				entriesByMediaId: nextEntriesById,
				mediaIdsByKey: nextMediaIdsByKey,
				reviewsByReviewId: nextReviewsByReviewId,
				myReviewIdsByKey: nextMyReviewIdsByKey,
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
			const { clearByKey, pushEntriesByKey } = get();
			// mediaIdsByKey[key] を初期化してから新規データを反映
			clearByKey(key);
			pushEntriesByKey(key, response.data);
			// nextCursorByKey[key] をセット
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
			}));
			// 取得済みフラグをセット
			set((state) => ({
				hasFetchedInitialByKey: { ...state.hasFetchedInitialByKey, [key]: true },
			}));
		}),

	fetchMoreByKey: async (key, request, fetcher) => {
		const { nextCursorByKey, pushEntriesByKey } = get();
		const nextCursor = nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		return handleAsyncAction(
			set,
			key,
			fetcher({ cursor: nextCursor, request }),
			(response) => {
				pushEntriesByKey(key, response.data);
				// nextCursorByKey[key] を更新
				set((prevState) => ({
					nextCursorByKey: { ...prevState.nextCursorByKey, [key]: response.nextCursor ?? null },
				}));
			},
			{ loadingType: "isLoadingMoreByKey" },
		);
	},

	fetchInitialWithMyReviewsByKey: async (key, request, fetcher) =>
		handleAsyncAction(set, key, fetcher({ request }), (response) => {
			const { clearByKey, pushEntriesWithMyReviewsByKey } = get();
			// mediaIdsByKey[key] を初期化してから新規データを反映
			clearByKey(key);
			pushEntriesWithMyReviewsByKey(key, response.data);
			// nextCursorByKey[key] をセット
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
			}));
			// 取得済みフラグをセット
			set((state) => ({
				hasFetchedInitialByKey: { ...state.hasFetchedInitialByKey, [key]: true },
			}));
		}),

	fetchMoreWithMyReviewsByKey: async (key, request, fetcher) => {
		const { nextCursorByKey, pushEntriesWithMyReviewsByKey } = get();
		const nextCursor = nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		return handleAsyncAction(
			set,
			key,
			fetcher({ cursor: nextCursor, request }),
			(response) => {
				// 取得データを末尾に追加
				pushEntriesWithMyReviewsByKey(key, response.data);
				// nextCursorByKey[key] を更新
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
	set: (
		partial: Partial<DishMediaEntriesStore> | ((state: DishMediaEntriesStore) => Partial<DishMediaEntriesStore>),
	) => void,
	key: string,
	promise: Promise<T>,
	onSuccess: (response: T) => void,
	option?: { loadingType?: keyof Pick<DishMediaEntriesStore, "isLoadingByKey" | "isLoadingMoreByKey"> },
) => {
	const { loadingType = "isLoadingByKey" } = option || {};
	// ローディング開始 & エラーリセット
	set((state) => ({
		[loadingType]: { ...state[loadingType], [key]: true },
		errorByKey: { ...state.errorByKey, [key]: null },
	}));

	return promise
		.then((items) => {
			onSuccess(items);
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

// ------ 正規化ヘルパー ------
/**
 * DishMediaEntry[] を正規化するヘルパー関数。
 * entriesByMediaId と reviewsByReviewId を更新し、
 * 追加された mediaId と reviewId の配列を返す。
 */
function normalizeDishMediaItems(state: DishMediaEntriesStore, items: DishMediaEntry[]) {
	const nextEntriesById = { ...state.entriesByMediaId };
	const nextReviewsById = { ...state.reviewsByReviewId };

	const addedMediaIds: string[] = [];
	const addedMyReviewIds: string[] = [];

	for (const item of items) {
		const { dish_reviews = [], ...rest } = item;

		const mediaId = String(item.dish_media.id);
		const dishReviewIds: string[] = [];

		// reviews を正規化
		for (const review of dish_reviews) {
			const reviewId = String(review.id);
			nextReviewsById[reviewId] = review;
			dishReviewIds.push(reviewId);
		}

		// 既存 entry に紐づく dishReviewIds をマージ（重複排除）
		const existingIds = nextEntriesById[mediaId]?.dishReviewIds ?? [];
		dishReviewIds.push(...existingIds.filter((id: string) => !dishReviewIds.includes(id)));

		// entry を上書き（常に最新で上書き）
		nextEntriesById[mediaId] = { ...rest, dishReviewIds };

		addedMediaIds.push(mediaId);

		// #457 【仕様】「自分のレビュー」系で一覧に載せるのは「最初のレビューID」
		if (dish_reviews.length > 0) {
			addedMyReviewIds.push(String(dish_reviews[0].id));
		}
	}

	return {
		nextEntriesById,
		nextReviewsById,
		addedMediaIds,
		addedMyReviewIds,
	};
}
