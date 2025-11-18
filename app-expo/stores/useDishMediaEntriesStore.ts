import type { DishMediaEntry } from "@shared/api/v1/res";
import { create } from "zustand";

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
	 * 画面用途キーごとのエラー状態。
	 */
	errorByKey: Record<string, Error | null>;

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
	pushMyReviewsByKey: (
		key: "reviews",
		items: (DishMediaEntry & { myReview: DishMediaEntry["dish_reviews"][number] })[],
	) => void;

	/**
	 * 指定した画面用途キーの先頭に DishMediaEntry の dish_reviews を追加する。
	 * reviewsByReviewId を更新しつつ、reviewIdsByKey[key] の先頭に reviewId を追加する。
	 * 既に同じ reviewId が存在する場合は、エントリは上書きする。
	 */
	unshiftMyReviewsByKey: (
		key: "reviews",
		items: (DishMediaEntry & { myReview: DishMediaEntry["dish_reviews"][number] })[],
	) => void;

	/**
	 * 指定した DishMediaEntry（dish_media.id）をピンポイントに更新する。
	 * 並び順には影響を与えない。
	 */
	updateEntry: (item: DishMediaEntry) => void;

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
	 * 成功時は pushMyReviewsByKey を利用して末尾に追加する。
	 */
	pushMyReviewsByKeyAsync: (
		key: "reviews",
		itemsPromise: Promise<(DishMediaEntry & { myReview: DishMediaEntry["dish_reviews"][number] })[]>,
	) => void;

	/**
	 * Promise を受け取り、共通的に loading / error / データ反映を行うヘルパー。
	 * 成功時は unshiftMyReviewsByKey を利用して先頭に追加する。
	 */
	unshiftMyReviewsByKeyAsync: (
		key: "reviews",
		itemsPromise: Promise<(DishMediaEntry & { myReview: DishMediaEntry["dish_reviews"][number] })[]>,
	) => void;

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
};

/**
 * 画面用途キーごとの状態を取得するためのセレクタ。
 * - entries: 正規化テーブルと mediaIdsByKey をもとに復元した DishMediaEntry の配列（デフォルト null）
 * - isLoading: 当該キーのロード中フラグ（デフォルト false）
 * - error: 当該キーのエラー（デフォルト null）
 */
export const selectEntriesByKey = (key: string) => (state: DishMediaEntriesStore) => {
	const ids: string[] | null = state.mediaIdsByKey[key] || null;
	return {
		entries:
			ids && ids.map((id) => state.entriesByMediaId[id]).filter((entry): entry is DishMediaEntry => Boolean(entry)),
		isLoading: state.isLoadingByKey[key] ?? false,
		error: state.errorByKey[key] ?? null,
	};
};

/**
 * reviews キー専用のセレクタ。
 * myReviewsByReviewId と entriesByMediaId を組み合わせて、
 * DishMediaEntry & { myReview } の配列を返す。
 *
 * - entries: 正規化テーブルから復元した DishMediaEntry の配列（myReview 付き）（デフォルト null）
 * - isLoading: "reviews" キーのロード中フラグ（デフォルト false）
 * - error: "reviews" キーのエラー（デフォルト null）
 */
export const selectMyReviewEntriesByKey = (key: "reviews") => (state: DishMediaEntriesStore) => {
	const reviewIds: string[] | null = state.myReviewIdsByKey[key] || null;
	return {
		entries:
			reviewIds &&
			reviewIds
				.map((reviewId) => {
					const review = state.myReviewsByReviewId[reviewId];
					if (!review) return null;
					const entry = state.entriesByMediaId[String(review.created_dish_media_id)];
					if (!entry) return null;
					return { ...entry, myReview: review };
				})
				.filter((entry): entry is DishMediaEntry & { myReview: DishMediaEntry["dish_reviews"][number] } =>
					Boolean(entry),
				),
		isLoading: state.isLoadingByKey[key] ?? false,
		error: state.errorByKey[key] ?? null,
	};
};

export const useDishMediaEntriesStore = create<DishMediaEntriesStore>((set, get) => ({
	// ------ 初期状態 ------

	entriesByMediaId: {},
	mediaIdsByKey: {},
	myReviewsByReviewId: {},
	myReviewIdsByKey: { reviews: [] },
	isLoadingByKey: {},
	errorByKey: {},

	// ------ 同期挿入メソッド ------

	pushEntriesByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;

			const nextEntriesById = { ...state.entriesByMediaId };
			const prevIds = state.mediaIdsByKey[key] ?? [];

			for (const item of items) {
				const mediaId = String(item.dish_media.id);
				// エントリは常に最新で上書き
				nextEntriesById[mediaId] = item;
				prevIds.push(mediaId);
			}

			return {
				...state,
				entriesByMediaId: nextEntriesById,
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: prevIds,
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
				...state,
				entriesByMediaId: nextEntriesById,
				mediaIdsByKey: {
					...state.mediaIdsByKey,
					[key]: [...newIds, ...prevIds],
				},
			};
		}),

	pushMyReviewsByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;

			const nextEntriesById = { ...state.entriesByMediaId };
			const nextReviewsById = { ...state.myReviewsByReviewId };
			const prevIds = state.myReviewIdsByKey[key] ?? [];

			for (const item of items) {
				// #443 【バグ】entriesByMediaId の更新が抜けていたため追加
				nextEntriesById[String(item.dish_media.id)] = item;
				nextReviewsById[String(item.myReview.id)] = item.myReview;
				prevIds.push(String(item.myReview.id));
			}

			return {
				...state,
				entriesByMediaId: nextEntriesById,
				myReviewsByReviewId: nextReviewsById,
				myReviewIdsByKey: {
					...state.myReviewIdsByKey,
					[key]: prevIds,
				},
			};
		}),

	unshiftMyReviewsByKey: (key, items) =>
		set((state) => {
			if (!items.length) return state;

			const nextEntriesById = { ...state.entriesByMediaId };
			const nextReviewsById = { ...state.myReviewsByReviewId };
			const prevIds = state.myReviewIdsByKey[key] ?? [];
			const newIds: string[] = [];

			for (const item of items) {
				// #443 【バグ】entriesByMediaId の更新が抜けていたため追加
				nextEntriesById[String(item.dish_media.id)] = item;
				nextReviewsById[String(item.myReview.id)] = item.myReview;
				newIds.push(String(item.myReview.id));
			}

			return {
				...state,
				entriesByMediaId: nextEntriesById,
				myReviewsByReviewId: nextReviewsById,
				myReviewIdsByKey: {
					...state.myReviewIdsByKey,
					[key]: [...newIds, ...prevIds],
				},
			};
		}),

	updateEntry: (item) =>
		set((state) => {
			const mediaId = String(item.dish_media.id);
			return {
				...state,
				entriesByMediaId: {
					...state.entriesByMediaId,
					[mediaId]: item,
				},
			};
		}),

	// ------ 非同期ラッパーメソッド ------

	pushEntriesByKeyAsync: (key, itemsPromise) => {
		// ローディング開始 & エラーリセット
		set((state) => ({
			...state,
			isLoadingByKey: { ...state.isLoadingByKey, [key]: true },
			errorByKey: { ...state.errorByKey, [key]: null },
		}));

		itemsPromise
			.then((items) => {
				get().pushEntriesByKey(key, items);
			})
			.catch((err) => {
				set((state) => ({
					...state,
					errorByKey: {
						...state.errorByKey,
						[key]: err instanceof Error ? err : new Error(String(err)),
					},
				}));
			})
			.finally(() => {
				set((state) => ({
					...state,
					isLoadingByKey: { ...state.isLoadingByKey, [key]: false },
				}));
			});
	},

	unshiftEntriesByKeyAsync: (key, itemsPromise) => {
		// ローディング開始 & エラーリセット
		set((state) => ({
			...state,
			isLoadingByKey: { ...state.isLoadingByKey, [key]: true },
			errorByKey: { ...state.errorByKey, [key]: null },
		}));

		itemsPromise
			.then((items) => {
				get().unshiftEntriesByKey(key, items);
			})
			.catch((err) => {
				set((state) => ({
					...state,
					errorByKey: {
						...state.errorByKey,
						[key]: err instanceof Error ? err : new Error(String(err)),
					},
				}));
			})
			.finally(() => {
				set((state) => ({
					...state,
					isLoadingByKey: { ...state.isLoadingByKey, [key]: false },
				}));
			});
	},

	pushMyReviewsByKeyAsync: (key, itemsPromise) => {
		// ローディング開始 & エラーリセット
		set((state) => ({
			...state,
			isLoadingByKey: { ...state.isLoadingByKey, [key]: true },
			errorByKey: { ...state.errorByKey, [key]: null },
		}));

		itemsPromise
			.then((items) => {
				get().pushMyReviewsByKey(key, items);
			})
			.catch((err) => {
				set((state) => ({
					...state,
					errorByKey: {
						...state.errorByKey,
						[key]: err instanceof Error ? err : new Error(String(err)),
					},
				}));
			})
			.finally(() => {
				set((state) => ({
					...state,
					isLoadingByKey: { ...state.isLoadingByKey, [key]: false },
				}));
			});
	},

	unshiftMyReviewsByKeyAsync: (key, itemsPromise) => {
		// ローディング開始 & エラーリセット
		set((state) => ({
			...state,
			isLoadingByKey: { ...state.isLoadingByKey, [key]: true },
			errorByKey: { ...state.errorByKey, [key]: null },
		}));

		itemsPromise
			.then((items) => {
				get().unshiftMyReviewsByKey(key, items);
			})
			.catch((err) => {
				set((state) => ({
					...state,
					errorByKey: {
						...state.errorByKey,
						[key]: err instanceof Error ? err : new Error(String(err)),
					},
				}));
			})
			.finally(() => {
				set((state) => ({
					...state,
					isLoadingByKey: { ...state.isLoadingByKey, [key]: false },
				}));
			});
	},

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
				};
			}

			// 該当キーを削除した mediaIdsByKey / myReviewIdsByKey / isLoadingByKey / errorByKey を作成
			const nextMediaIdsByKey = { ...state.mediaIdsByKey };
			const nextMyReviewIdsByKey = { ...state.myReviewIdsByKey };
			const nextIsLoadingByKey = { ...state.isLoadingByKey };
			const nextErrorByKey = { ...state.errorByKey };

			delete nextMediaIdsByKey[key];
			delete nextIsLoadingByKey[key];
			delete nextErrorByKey[key];

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
			};
		}),
}));
