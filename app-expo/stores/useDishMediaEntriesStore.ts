// #454 【設計】DishMediaEntry の正規化ストア + カーソルページネーション統合
import type { DishMediaEntry } from "@shared/api/v1/res";
import { create } from "zustand";
import { createCursorController, type Fetcher } from "@/lib/createCursorController";

// #454 【設計】キーごとのカーソルコントローラーを管理するためのMap
type ControllerMap = Map<string, ReturnType<typeof createCursorController<any, DishMediaEntry>>>;

type DishMediaEntriesStore = {
	// #454 【設計】正規化テーブル: dish_media.id -> DishMediaEntry
	entriesByMediaId: Record<string, DishMediaEntry>;

	// #454 【設計】画面用途キーごとの並び順（dish_media.id の配列）
	mediaIdsByKey: Record<string, string[]>;

	// #454 【設計】レビュータブ用: dish_reviews[0].id の配列
	myReviewIdsByKey: Record<string, string[]>;

	// #454 【設計】ローディング状態（初期ロード用）
	isLoadingByKey: Record<string, boolean>;

	// #454 【設計】追加ロード中状態
	isLoadingMoreByKey: Record<string, boolean>;

	// #454 【設計】エラー状態
	errorByKey: Record<string, string | null>;

	// #454 【設計】次のカーソル
	nextCursorByKey: Record<string, string | null>;

	// #454 【設計】カーソルコントローラーのインスタンスを保持（内部用）
	_controllers: ControllerMap;

	// === セレクタ（既存互換） ===

	/**
	 * キーに対応するdish_media.idの配列を取得
	 */
	selectIdsByKey: (key: string) => string[];

	/**
	 * dish_media.idから正規化されたエントリを取得
	 */
	selectEntryById: (mediaId: string) => DishMediaEntry | undefined;

	/**
	 * キーに対応するレビューIDの配列を取得（レビュータブ用）
	 */
	selectReviewIdsByKey: (key: string) => string[];

	// === ページネーションAPI ===

	/**
	 * 初期取得 + storeへの反映
	 * @param key 画面用途キー（例: "mapReviews", "profileLikes"）
	 * @param request リクエストパラメータ
	 * @param fetcher データ取得関数
	 */
	fetchInitialByKey: <TReq>(
		key: string,
		request: TReq,
		fetcher: Fetcher<TReq, DishMediaEntry>,
	) => Promise<void>;

	/**
	 * 追加ページ取得 + storeへの追記
	 * @param key 画面用途キー
	 * @param fetcher データ取得関数
	 */
	fetchMoreByKey: <TReq>(
		key: string,
		fetcher: Fetcher<TReq, DishMediaEntry>,
	) => Promise<void>;

	/**
	 * リフレッシュ（再初期化）
	 * @param key 画面用途キー
	 */
	refreshByKey: (key: string) => Promise<void>;

	// === 既存メソッド ===

	/**
	 * キーをクリア（カーソル関連stateも含めて全てクリア）
	 */
	clearByKey: (key: string) => void;

	/**
	 * エントリを手動でpush（既存互換用、非推奨）
	 * @deprecated 新規実装では fetchInitialByKey / fetchMoreByKey を使用すること
	 */
	pushEntriesByKey: (key: string, entries: DishMediaEntry[]) => void;

	// === 旧実装互換（段階的移行のため残す） ===
	dishPromisesMap: Record<string, Promise<DishMediaEntry[]>>;
	setDishePromises: (key: string, items: Promise<DishMediaEntry[]>) => void;
	clearDishes: (key?: string) => void;
};

export const useDishMediaEntriesStore = create<DishMediaEntriesStore>((set, get) => ({
	// === State ===
	entriesByMediaId: {},
	mediaIdsByKey: {},
	myReviewIdsByKey: {},
	isLoadingByKey: {},
	isLoadingMoreByKey: {},
	errorByKey: {},
	nextCursorByKey: {},
	_controllers: new Map(),

	// === 旧実装互換 ===
	dishPromisesMap: {},
	setDishePromises: (key, items) =>
		set((state) => ({
			dishPromisesMap: {
				...state.dishPromisesMap,
				[key]: items,
			},
		})),
	clearDishes: (key) =>
		set((state) => {
			if (!key) return { dishPromisesMap: {} };
			const newMap = { ...state.dishPromisesMap };
			delete newMap[key];
			return { dishPromisesMap: newMap };
		}),

	// === セレクタ ===
	selectIdsByKey: (key: string) => {
		return get().mediaIdsByKey[key] || [];
	},

	selectEntryById: (mediaId: string) => {
		return get().entriesByMediaId[mediaId];
	},

	selectReviewIdsByKey: (key: string) => {
		return get().myReviewIdsByKey[key] || [];
	},

	// === ページネーションAPI ===
	fetchInitialByKey: async <TReq,>(
		key: string,
		request: TReq,
		fetcher: Fetcher<TReq, DishMediaEntry>,
	) => {
		const state = get();
		
		// #454 【設計】コントローラーが存在しない場合は新規作成
		let controller = state._controllers.get(key);
		if (!controller) {
			controller = createCursorController<TReq, DishMediaEntry>(fetcher, {
				onItemsUpdated: (items, isInitial) => {
					const currentState = get();
					const newEntriesById = { ...currentState.entriesByMediaId };
					const newIds: string[] = isInitial ? [] : [...(currentState.mediaIdsByKey[key] || [])];
					const newReviewIds: string[] = isInitial ? [] : [...(currentState.myReviewIdsByKey[key] || [])];

					items.forEach((entry) => {
						newEntriesById[entry.dish_media.id] = entry;
						if (!newIds.includes(entry.dish_media.id)) {
							newIds.push(entry.dish_media.id);
						}
						// レビュータブ用
						if (entry.dish_reviews && entry.dish_reviews.length > 0) {
							const reviewId = entry.dish_reviews[0].id;
							if (!newReviewIds.includes(reviewId)) {
								newReviewIds.push(reviewId);
							}
						}
					});

					set({
						entriesByMediaId: newEntriesById,
						mediaIdsByKey: { ...currentState.mediaIdsByKey, [key]: newIds },
						myReviewIdsByKey: { ...currentState.myReviewIdsByKey, [key]: newReviewIds },
					});
				},
			});
			state._controllers.set(key, controller);
		}

		// #454 【設計】ローディング状態を更新
		set({
			isLoadingByKey: { ...get().isLoadingByKey, [key]: true },
			errorByKey: { ...get().errorByKey, [key]: null },
		});

		try {
			await controller.loadInitial(request);
			const controllerState = controller.getState();
			set({
				nextCursorByKey: { ...get().nextCursorByKey, [key]: controllerState.nextCursor },
				isLoadingByKey: { ...get().isLoadingByKey, [key]: false },
			});
		} catch (err) {
			set({
				errorByKey: {
					...get().errorByKey,
					[key]: err instanceof Error ? err.message : String(err),
				},
				isLoadingByKey: { ...get().isLoadingByKey, [key]: false },
			});
		}
	},

	fetchMoreByKey: async <TReq,>(
		key: string,
		fetcher: Fetcher<TReq, DishMediaEntry>,
	) => {
		const state = get();
		const controller = state._controllers.get(key);
		
		// #454 【設計】コントローラーが存在しない場合、または nextCursor が null の場合は何もしない
		if (!controller || state.nextCursorByKey[key] === null) {
			return;
		}

		set({
			isLoadingMoreByKey: { ...get().isLoadingMoreByKey, [key]: true },
			errorByKey: { ...get().errorByKey, [key]: null },
		});

		try {
			await controller.loadMore();
			const controllerState = controller.getState();
			set({
				nextCursorByKey: { ...get().nextCursorByKey, [key]: controllerState.nextCursor },
				isLoadingMoreByKey: { ...get().isLoadingMoreByKey, [key]: false },
			});
		} catch (err) {
			set({
				errorByKey: {
					...get().errorByKey,
					[key]: err instanceof Error ? err.message : String(err),
				},
				isLoadingMoreByKey: { ...get().isLoadingMoreByKey, [key]: false },
			});
		}
	},

	refreshByKey: async (key: string) => {
		const state = get();
		const controller = state._controllers.get(key);
		
		if (!controller) {
			return;
		}

		set({
			isLoadingByKey: { ...get().isLoadingByKey, [key]: true },
			errorByKey: { ...get().errorByKey, [key]: null },
		});

		try {
			await controller.refresh();
			const controllerState = controller.getState();
			set({
				nextCursorByKey: { ...get().nextCursorByKey, [key]: controllerState.nextCursor },
				isLoadingByKey: { ...get().isLoadingByKey, [key]: false },
			});
		} catch (err) {
			set({
				errorByKey: {
					...get().errorByKey,
					[key]: err instanceof Error ? err.message : String(err),
				},
				isLoadingByKey: { ...get().isLoadingByKey, [key]: false },
			});
		}
	},

	clearByKey: (key: string) => {
		const state = get();
		const newMediaIdsByKey = { ...state.mediaIdsByKey };
		const newMyReviewIdsByKey = { ...state.myReviewIdsByKey };
		const newIsLoadingByKey = { ...state.isLoadingByKey };
		const newIsLoadingMoreByKey = { ...state.isLoadingMoreByKey };
		const newErrorByKey = { ...state.errorByKey };
		const newNextCursorByKey = { ...state.nextCursorByKey };
		const newControllers = new Map(state._controllers);

		delete newMediaIdsByKey[key];
		delete newMyReviewIdsByKey[key];
		delete newIsLoadingByKey[key];
		delete newIsLoadingMoreByKey[key];
		delete newErrorByKey[key];
		delete newNextCursorByKey[key];
		newControllers.delete(key);

		set({
			mediaIdsByKey: newMediaIdsByKey,
			myReviewIdsByKey: newMyReviewIdsByKey,
			isLoadingByKey: newIsLoadingByKey,
			isLoadingMoreByKey: newIsLoadingMoreByKey,
			errorByKey: newErrorByKey,
			nextCursorByKey: newNextCursorByKey,
			_controllers: newControllers,
		});
	},

	pushEntriesByKey: (key: string, entries: DishMediaEntry[]) => {
		const state = get();
		const newEntriesById = { ...state.entriesByMediaId };
		const newIds = [...(state.mediaIdsByKey[key] || [])];
		const newReviewIds = [...(state.myReviewIdsByKey[key] || [])];

		entries.forEach((entry) => {
			newEntriesById[entry.dish_media.id] = entry;
			if (!newIds.includes(entry.dish_media.id)) {
				newIds.push(entry.dish_media.id);
			}
			if (entry.dish_reviews && entry.dish_reviews.length > 0) {
				const reviewId = entry.dish_reviews[0].id;
				if (!newReviewIds.includes(reviewId)) {
					newReviewIds.push(reviewId);
				}
			}
		});

		set({
			entriesByMediaId: newEntriesById,
			mediaIdsByKey: { ...state.mediaIdsByKey, [key]: newIds },
			myReviewIdsByKey: { ...state.myReviewIdsByKey, [key]: newReviewIds },
		});
	},
}));
