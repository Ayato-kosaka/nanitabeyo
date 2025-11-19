import i18n from "@/lib/i18n";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { createWithEqualityFn } from "zustand/traditional";

/**
 * 料理メディア（dish_media）に関する正規化済みの状態を管理するストア。
 *
 * - entriesByMediaId: dish_media.id をキーにした正規化テーブル（唯一のソース・オブ・トゥルース）
 * - mediaIdsByKey: 画面用途キーごとの並び順（feed / 検索結果 / プロフィールなど）
 * - isLoadingByKey / errorByKey: 画面用途キーごとの読み込み・エラー状態
 *
 * フェッチ処理自体はコンポーネントやサービス側で行い、
 * 本ストアは「正規化されたデータ」と「画面用途キーごとの状態」のみを扱う。
 */
export type DishMediaEntriesStore = {
	// ------ 内部状態（直接参照せず、セレクタ経由で読むことを推奨） ------

	/**
	 * dish_media.id をキーにした DishMediaEntry のマップ。
	 * ここが料理メディア情報の唯一のソース・オブ・トゥルース。
	 */
	entriesByMediaId: Record<string, DishMediaEntry>;

	/**
	 * 画面用途キー（例: "map", "liked"）ごとの dish_media.id の配列。
	 * 並び順の管理のみを担当し、実体は entriesByMediaId を参照する。
	 */
	mediaIdsByKey: Record<string, string[]>;

	/**
	 * dish_review.id をキーにした dish_reviews エントリのマップ。
	 * reviews キーの画面で利用するための正規化テーブル。
	 */
	myReviewsByReviewId: Record<string, DishMediaEntry["dish_reviews"][number]>;

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
	 * #454 【設計】カーソルページネーション用の nextCursor を画面用途キーごとに管理
	 */
	nextCursorByKey: Record<string, string | null>;

	/**
	 * #454 【設計】追加ページ取得中かどうかを画面用途キーごとに管理
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
	 * 並び順には影響を与えない。
	 */
	updateEntry: (dishMediaId: string, entryUpdater: (entry: DishMediaEntry) => DishMediaEntry) => void;

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

	// ------ #454 【設計】カーソルページネーション API ------

	/**
	 * 初期取得 + store への反映
	 *
	 * @param key - 画面用途キー
	 * @param request - リクエストパラメータ
	 * @param fetcher - データ取得関数
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
	 *
	 * @param key - 画面用途キー
	 * @param request - リクエストパラメータ（fetchMoreByKey 時も必要な場合に利用）
	 * @param fetcher - データ取得関数
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
	 *
	 * @param key - 画面用途キー（"reviews" 固定）
	 * @param request - リクエストパラメータ
	 * @param fetcher - データ取得関数
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
	 *
	 * @param key - 画面用途キー（"reviews" 固定）
	 * @param request - リクエストパラメータ（fetchMoreByKey 時も必要な場合に利用）
	 * @param fetcher - データ取得関数
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
 * - #454 【設計】hasNextPage: 次ページがあるかどうか（デフォルト false）
 * - #454 【設計】isLoadingMore: 追加ページ取得中かどうか（デフォルト false）
 */
export const selectIdsByKey =
	(key: string) =>
	(
		state: DishMediaEntriesStore,
	): {
		ids: string[];
		isLoading: boolean;
		error: string | null;
		hasNextPage: boolean;
		isLoadingMore: boolean;
	} => {
		const ids = (key === "reviews" ? state.myReviewIdsByKey[key] : state.mediaIdsByKey[key]) || [];
		return {
			ids,
			isLoading: state.isLoadingByKey[key] ?? false,
			error: state.errorByKey[key] ?? null,
			hasNextPage: (state.nextCursorByKey[key] ?? null) !== null,
			isLoadingMore: state.isLoadingMoreByKey[key] ?? false,
		};
	};

/**
 * dish_media.id または dish_review.id から DishMediaEntry を取得するセレクタ。
 * - option.key に "reviews" を指定した場合、myReviewsByReviewId 経由でレビュー情報を含むエントリを取得する。
 */
export const selectEntryById =
	(id: string, option?: { key?: string }) =>
	(
		state: DishMediaEntriesStore,
	): {
		entry: DishMediaEntry | null;
		myReview: DishMediaEntry["dish_reviews"][number] | null;
	} => {
		const { key } = option || {};
		let entry: DishMediaEntry | null = null;
		let myReview: DishMediaEntry["dish_reviews"][number] | null = null;
		if (key === "reviews") {
			myReview = state.myReviewsByReviewId[id];
			if (myReview) {
				entry = state.entriesByMediaId[String(myReview.created_dish_media_id)] || null;
			}
		} else {
			entry = state.entriesByMediaId[id] || null;
		}
		return { entry, myReview };
	};

// ------ 非同期挿入ヘルパー ------
const handleAsyncAction = (
	set: (
		partial: Partial<DishMediaEntriesStore> | ((state: DishMediaEntriesStore) => Partial<DishMediaEntriesStore>),
	) => void,
	key: string,
	itemsPromise: Promise<DishMediaEntry[]>,
	onSuccess: (items: DishMediaEntry[]) => void,
) => {
	// ローディング開始 & エラーリセット
	set((state) => ({
		isLoadingByKey: { ...state.isLoadingByKey, [key]: true },
		errorByKey: { ...state.errorByKey, [key]: null },
	}));

	itemsPromise
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
				isLoadingByKey: { ...state.isLoadingByKey, [key]: false },
			}));
		});
};

export const useDishMediaEntriesStore = createWithEqualityFn<DishMediaEntriesStore>()((set, get) => ({
	// ------ 初期状態 ------

	entriesByMediaId: {},
	mediaIdsByKey: {},
	myReviewsByReviewId: {},
	myReviewIdsByKey: { reviews: [] },
	isLoadingByKey: {},
	errorByKey: {},
	nextCursorByKey: {},
	isLoadingMoreByKey: {},

	// ------ 同期挿入メソッド ------

	pushEntriesByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;

			const nextEntriesById = { ...state.entriesByMediaId };
			const prevIds = state.mediaIdsByKey[key] ?? [];
			const nextIds = [...prevIds];

			for (const item of items) {
				const mediaId = String(item.dish_media.id);
				// エントリは常に最新で上書き
				nextEntriesById[mediaId] = item;
				nextIds.push(mediaId);
			}

			return {
				entriesByMediaId: nextEntriesById,
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: nextIds,
				},
			};
		}),

	unshiftEntriesByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;

			const nextEntriesById = { ...state.entriesByMediaId };
			const prevIds = state.mediaIdsByKey[key] ?? [];
			const newIds: string[] = [];

			for (const item of items) {
				const mediaId = String(item.dish_media.id);
				// エントリは常に最新で上書き
				nextEntriesById[mediaId] = item;
				newIds.push(mediaId);
			}

			return {
				entriesByMediaId: nextEntriesById,
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: [...newIds, ...prevIds],
				},
			};
		}),

	pushEntriesWithMyReviewsByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;

			const nextEntriesById = { ...state.entriesByMediaId };
			const nextReviewsById = { ...state.myReviewsByReviewId };
			const prevIds = state.myReviewIdsByKey[key] ?? [];
			const nextIds = [...prevIds];

			for (const item of items) {
				if (item.dish_reviews && item.dish_reviews.length > 0) {
					nextEntriesById[String(item.dish_media.id)] = item;
					nextReviewsById[String(item.dish_reviews[0].id)] = item.dish_reviews[0];
					nextIds.push(String(item.dish_reviews[0].id));
				}
			}

			return {
				entriesByMediaId: nextEntriesById,
				myReviewsByReviewId: nextReviewsById,
				myReviewIdsByKey: {
					...state.myReviewIdsByKey,
					[key]: nextIds,
				},
			};
		}),

	unshiftEntriesWithMyReviewsByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;

			const nextEntriesById = { ...state.entriesByMediaId };
			const nextReviewsById = { ...state.myReviewsByReviewId };
			const prevIds = state.myReviewIdsByKey[key] ?? [];
			const newIds: string[] = [];

			for (const item of items) {
				if (item.dish_reviews && item.dish_reviews.length > 0) {
					nextEntriesById[String(item.dish_media.id)] = item;
					nextReviewsById[String(item.dish_reviews[0].id)] = item.dish_reviews[0];
					newIds.push(String(item.dish_reviews[0].id));
				}
			}

			return {
				entriesByMediaId: nextEntriesById,
				myReviewsByReviewId: nextReviewsById,
				myReviewIdsByKey: {
					...state.myReviewIdsByKey,
					[key]: [...newIds, ...prevIds],
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
					myReviewsByReviewId: {},
					myReviewIdsByKey: { reviews: [] },
					isLoadingByKey: {},
					errorByKey: {},
					nextCursorByKey: {},
					isLoadingMoreByKey: {},
				};
			}

			// 該当キーを削除した mediaIdsByKey / myReviewIdsByKey / isLoadingByKey / errorByKey を作成
			const nextMediaIdsByKey = { ...state.mediaIdsByKey };
			const nextMyReviewIdsByKey = { ...state.myReviewIdsByKey };
			const nextIsLoadingByKey = { ...state.isLoadingByKey };
			const nextErrorByKey = { ...state.errorByKey };
			const nextNextCursorByKey = { ...state.nextCursorByKey };
			const nextIsLoadingMoreByKey = { ...state.isLoadingMoreByKey };

			delete nextMediaIdsByKey[key];
			delete nextIsLoadingByKey[key];
			delete nextErrorByKey[key];
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

			// reviews 側から参照されている mediaId も残す（必要なら）
			// ※ myReview から dish_media_id が取れる前提
			for (const reviewId of nextMyReviewIdsByKey.reviews) {
				const review = state.myReviewsByReviewId[reviewId];
				if (review) {
					remainingMediaIds.add(String(review.created_dish_media_id));
				}
			}

			// entriesByMediaId をクリーンアップ
			const nextEntriesById: Record<string, DishMediaEntry> = {};
			for (const id of remainingMediaIds) {
				const entry = state.entriesByMediaId[id];
				if (entry) {
					nextEntriesById[id] = entry;
				}
			}

			// reviews 側も同様にクリーンアップ
			const remainingReviewIds = new Set(nextMyReviewIdsByKey.reviews);
			const nextMyReviewsByReviewId: typeof state.myReviewsByReviewId = {};
			for (const id of remainingReviewIds) {
				const review = state.myReviewsByReviewId[id];
				if (review) nextMyReviewsByReviewId[id] = review;
			}

			return {
				entriesByMediaId: nextEntriesById,
				mediaIdsByKey: nextMediaIdsByKey,
				myReviewsByReviewId: nextMyReviewsByReviewId,
				myReviewIdsByKey: nextMyReviewIdsByKey,
				isLoadingByKey: nextIsLoadingByKey,
				errorByKey: nextErrorByKey,
				nextCursorByKey: nextNextCursorByKey,
				isLoadingMoreByKey: nextIsLoadingMoreByKey,
			};
		}),

	// ------ #454 【設計】カーソルページネーション API の実装 ------

	fetchInitialByKey: async (key, request, fetcher) => {
		// isLoadingByKey[key] を true にし、エラーをクリア
		set((state) => ({
			isLoadingByKey: { ...state.isLoadingByKey, [key]: true },
			errorByKey: { ...state.errorByKey, [key]: null },
		}));

		try {
			const response = await fetcher({ request });
			// mediaIdsByKey[key] を初期化してから新規データを反映
			set((state) => ({
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: [], // 初期化
				},
			}));
			get().pushEntriesByKey(key, response.data);
			// nextCursorByKey[key] をセット
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
			}));
		} catch (err) {
			const errorMessage = err ? (err instanceof Error ? err.message : String(err)) : null;
			set((state) => ({
				errorByKey: {
					...state.errorByKey,
					[key]: i18n.t("Profile.tabError.failedToLoad", { error: errorMessage }),
				},
			}));
		} finally {
			set((state) => ({
				isLoadingByKey: { ...state.isLoadingByKey, [key]: false },
			}));
		}
	},

	fetchMoreByKey: async (key, request, fetcher) => {
		const state = get();
		const nextCursor = state.nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		// isLoadingMoreByKey[key] を true にし、エラーをクリア
		set((prevState) => ({
			isLoadingMoreByKey: { ...prevState.isLoadingMoreByKey, [key]: true },
			errorByKey: { ...prevState.errorByKey, [key]: null },
		}));

		try {
			const response = await fetcher({ cursor: nextCursor, request });
			// 取得データを末尾に追加
			get().pushEntriesByKey(key, response.data);
			// nextCursorByKey[key] を更新
			set((prevState) => ({
				nextCursorByKey: { ...prevState.nextCursorByKey, [key]: response.nextCursor ?? null },
			}));
		} catch (err) {
			const errorMessage = err ? (err instanceof Error ? err.message : String(err)) : null;
			set((prevState) => ({
				errorByKey: {
					...prevState.errorByKey,
					[key]: i18n.t("Profile.tabError.failedToLoad", { error: errorMessage }),
				},
			}));
		} finally {
			set((prevState) => ({
				isLoadingMoreByKey: { ...prevState.isLoadingMoreByKey, [key]: false },
			}));
		}
	},

	fetchInitialWithMyReviewsByKey: async (key, request, fetcher) => {
		// isLoadingByKey[key] を true にし、エラーをクリア
		set((state) => ({
			isLoadingByKey: { ...state.isLoadingByKey, [key]: true },
			errorByKey: { ...state.errorByKey, [key]: null },
		}));

		try {
			const response = await fetcher({ request });
			// myReviewIdsByKey[key] を初期化してから新規データを反映
			set((state) => ({
				myReviewIdsByKey: {
					...state.myReviewIdsByKey,
					[key]: [], // 初期化
				},
			}));
			get().pushEntriesWithMyReviewsByKey(key, response.data);
			// nextCursorByKey[key] をセット
			set((state) => ({
				nextCursorByKey: { ...state.nextCursorByKey, [key]: response.nextCursor ?? null },
			}));
		} catch (err) {
			const errorMessage = err ? (err instanceof Error ? err.message : String(err)) : null;
			set((state) => ({
				errorByKey: {
					...state.errorByKey,
					[key]: i18n.t("Profile.tabError.failedToLoad", { error: errorMessage }),
				},
			}));
		} finally {
			set((state) => ({
				isLoadingByKey: { ...state.isLoadingByKey, [key]: false },
			}));
		}
	},

	fetchMoreWithMyReviewsByKey: async (key, request, fetcher) => {
		const state = get();
		const nextCursor = state.nextCursorByKey[key];

		// nextCursor が null の場合は何もしない
		if (nextCursor === null || nextCursor === undefined) return;

		// isLoadingMoreByKey[key] を true にし、エラーをクリア
		set((prevState) => ({
			isLoadingMoreByKey: { ...prevState.isLoadingMoreByKey, [key]: true },
			errorByKey: { ...prevState.errorByKey, [key]: null },
		}));

		try {
			const response = await fetcher({ cursor: nextCursor, request });
			// 取得データを末尾に追加
			get().pushEntriesWithMyReviewsByKey(key, response.data);
			// nextCursorByKey[key] を更新
			set((prevState) => ({
				nextCursorByKey: { ...prevState.nextCursorByKey, [key]: response.nextCursor ?? null },
			}));
		} catch (err) {
			const errorMessage = err ? (err instanceof Error ? err.message : String(err)) : null;
			set((prevState) => ({
				errorByKey: {
					...prevState.errorByKey,
					[key]: i18n.t("Profile.tabError.failedToLoad", { error: errorMessage }),
				},
			}));
		} finally {
			set((prevState) => ({
				isLoadingMoreByKey: { ...prevState.isLoadingMoreByKey, [key]: false },
			}));
		}
	},
}));
