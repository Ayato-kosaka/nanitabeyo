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

	// #460 【設計】DishMediaEntry 配列を正規化してストアに反映（並び順には触れない）
	/**
	 * DishMediaEntry 配列を正規化して entriesByMediaId と reviewsByReviewId を更新する。
	 * 並び順（mediaIdsByKey / myReviewIdsByKey）には触れない。
	 */
	upsertDishMediaEntries: (items: DishMediaEntry[]) => void;

	/**
	 * 指定キーの mediaId 配列を更新する（並び順専用）。
	 */
	updateMediaIdsByKey: (key: string, updater: (prevIds: string[]) => string[]) => void;

	/**
	 * "reviews" キーの reviewId 配列を更新する（並び順専用）。
	 */
	updateMyReviewIdsByKey: (key: "reviews", updater: (prevIds: string[]) => string[]) => void;

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

	// ------ public 挿入・更新メソッド（非同期ラッパー） ------
	/**
	 * 非同期に取得した mediaId 配列で指定キーの mediaIdsByKey を更新する。
	 */
	updateMediaIdsByKeyAsync: (
		key: string,
		idsPromise: Promise<string[]>,
		updater: (prevIds: string[], fetchedIds: string[]) => string[],
	) => Promise<void>;

	/**
	 * 非同期に取得した reviewId 配列で "reviews" キーの myReviewIdsByKey を更新する。
	 */
	updateMyReviewIdsByKeyAsync: (
		key: "reviews",
		idsPromise: Promise<string[]>,
		updater: (prevIds: string[], fetchedIds: string[]) => string[],
	) => Promise<void>;

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

	// ------ 同期挿入・更新メソッド ------

	// #460 【設計】DishMediaEntry を正規化（並び順には触れない）
	upsertDishMediaEntries: (items) =>
		set((state) => {
			if (!items.length) return state;
			const { entriesPatch, reviewsPatch } = buildDishMediaPatches(state, items);
			return {
				entriesByMediaId: {
					...state.entriesByMediaId,
					...entriesPatch,
				},
				reviewsByReviewId: {
					...state.reviewsByReviewId,
					...reviewsPatch,
				},
			};
		}),

	// #460 【設計】並び順専用メソッド
	updateMediaIdsByKey: (key, updater) =>
		set((state) => {
			const prevIds = state.mediaIdsByKey[key] ?? [];
			const nextIds = updater(prevIds);
			return {
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: nextIds,
				},
			};
		}),

	updateMyReviewIdsByKey: (key, updater) =>
		set((state) => {
			const prevIds = state.myReviewIdsByKey[key] ?? [];
			const nextIds = updater(prevIds);
			return {
				myReviewIdsByKey: {
					...state.myReviewIdsByKey,
					[key]: nextIds,
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

	// ------ 非同期挿入・更新メソッド ------
	updateMediaIdsByKeyAsync: async (key, promise, updater) =>
		handleAsyncAction(set, key, promise, (fetchedIds) =>
			get().updateMediaIdsByKey(key, (prevIds) => updater(prevIds, fetchedIds)),
		),

	updateMyReviewIdsByKeyAsync: async (key, promise, updater) =>
		handleAsyncAction(set, key, promise, (fetchedIds) =>
			get().updateMyReviewIdsByKey(key, (prevIds) => updater(prevIds, fetchedIds)),
		),

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
			const { clearByKey, upsertDishMediaEntries, updateMediaIdsByKey } = get();
			// mediaIdsByKey[key] を初期化してから新規データを反映
			clearByKey(key);

			// 1. エンティティを正規化して反映
			upsertDishMediaEntries(response.data);

			// 2. 並び順を id でセット
			const mediaIds = response.data.map((item) => String(item.dish_media.id));
			updateMediaIdsByKey(key, () => mediaIds);

			// 3. nextCursor / hasFetchedInitial の更新
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
				hasFetchedInitialByKey: { ...state.hasFetchedInitialByKey, [key]: true },
			}));
		}),

	fetchMoreByKey: async (key, request, fetcher) => {
		const { nextCursorByKey, upsertDishMediaEntries, updateMediaIdsByKey } = get();
		const nextCursor = nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		return handleAsyncAction(
			set,
			key,
			fetcher({ cursor: nextCursor, request }),
			(response) => {
				// 1. エンティティを正規化
				upsertDishMediaEntries(response.data);

				// 2. 並び順の末尾に追加
				const mediaIds = response.data.map((item) => String(item.dish_media.id));
				updateMediaIdsByKey(key, (prevIds) => {
					// #CodeQL 【バグ】重複IDを排除して追加（paginationで同じIDが返る場合に備える）
					const newIds = mediaIds.filter((id) => !prevIds.includes(id));
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

	fetchInitialWithMyReviewsByKey: async (key, request, fetcher) =>
		handleAsyncAction(set, key, fetcher({ request }), (response) => {
			const { clearByKey, upsertDishMediaEntries, updateMyReviewIdsByKey } = get();
			// mediaIdsByKey[key] を初期化してから新規データを反映
			clearByKey(key);

			// 1. エンティティを正規化して反映
			upsertDishMediaEntries(response.data);

			// 2. 自分のレビュー一覧の id 配列をセット（最初のレビューのみ）
			const myReviewIds = response.data
				.filter((item) => item.dish_reviews.length > 0)
				.map((item) => String(item.dish_reviews[0].id));
			updateMyReviewIdsByKey(key, () => myReviewIds);

			// 3. nextCursor / hasFetchedInitial の更新
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
				hasFetchedInitialByKey: { ...state.hasFetchedInitialByKey, [key]: true },
			}));
		}),

	// #460 【設計】fetchMoreWithMyReviewsByKey を新API（upsertDishMediaEntries + updateMyReviewIdsByKey）に移行
	fetchMoreWithMyReviewsByKey: async (key, request, fetcher) => {
		const { nextCursorByKey, upsertDishMediaEntries, updateMyReviewIdsByKey } = get();
		const nextCursor = nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		return handleAsyncAction(
			set,
			key,
			fetcher({ cursor: nextCursor, request }),
			(response) => {
				// 1. エンティティを正規化
				upsertDishMediaEntries(response.data);

				// 2. 自分のレビュー一覧の id 配列の末尾に追加（最初のレビューのみ）
				const myReviewIds = response.data
					.filter((item) => item.dish_reviews.length > 0)
					.map((item) => String(item.dish_reviews[0].id));
				// #CodeQL 【バグ】レビューID重複防止のため、既存IDと重複しないもののみ追加
				updateMyReviewIdsByKey(key, (prevIds) => {
					const newIds = myReviewIds.filter((id) => !prevIds.includes(id));
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
 * DishMediaEntry 配列を正規化してパッチを生成するヘルパー。
 */
function buildDishMediaPatches(
	state: DishMediaEntriesStore,
	items: DishMediaEntry[],
): {
	entriesPatch: Record<string, NormalizedDishMediaEntry>;
	reviewsPatch: Record<string, DishReview>;
} {
	const entriesPatch: Record<string, NormalizedDishMediaEntry> = {};
	const reviewsPatch: Record<string, DishReview> = {};

	for (const item of items) {
		const { dish_reviews = [], ...rest } = item;
		const mediaId = String(item.dish_media.id);
		const dishReviewIds: string[] = [];

		// reviews をパッチに積む
		for (const review of dish_reviews) {
			const reviewId = String(review.id);
			reviewsPatch[reviewId] = review;
			dishReviewIds.push(reviewId);
		}

		// 既存 entry から dishReviewIds をマージ（重複排除）
		const existingEntry = entriesPatch[mediaId] ?? state.entriesByMediaId[mediaId];
		if (existingEntry) {
			for (const id of existingEntry.dishReviewIds) {
				if (!dishReviewIds.includes(id)) {
					dishReviewIds.push(id);
				}
			}
		}

		entriesPatch[mediaId] = { ...rest, dishReviewIds };
	}

	return { entriesPatch, reviewsPatch };
}
