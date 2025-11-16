import type { DishMediaEntry } from "@shared/api/v1/res";
import { create } from "zustand";

// #433 【設計】Dish/Topic フェッチャー＆いいね履歴・投稿履歴のストア統一設計対応
// Dish のメタデータ＋ローカルメディア情報を保持する拡張型
type DishMediaEntryWithState = DishMediaEntry & {
	// ローカルURIとメディア準備状況（サムネイルリサイズ対応）
	localMediaUri?: string;
	localMediaStatus?: "idle" | "fetching" | "ready" | "error";
	// いいね状態（楽観的更新対応）
	isLiked: boolean;
	// 保存状態（楽観的更新対応）
	isSaved: boolean;
};

type DishMediaEntriesStore = {
	// #433 【設計】生の Promise を保持（フェッチ中かどうかは Promise の有無や状態から判断）
	dishPromisesMap: Record<string, Promise<DishMediaEntry[]>>;
	// #433 【設計】dishId をキーとした Dish エンティティのマップ（唯一のソースオブトゥルース）
	dishEntriesById: Record<string, DishMediaEntryWithState>;
	
	// Promise 設定（フェッチ結果の保存）
	setDishePromises: (key: string, items: Promise<DishMediaEntry[]>) => void;
	// Dish エンティティの保存・更新
	setDishEntry: (dishMediaId: string, entry: DishMediaEntry) => void;
	updateDishEntry: (dishMediaId: string, updates: Partial<DishMediaEntryWithState>) => void;
	// いいね状態の更新（楽観的更新用）
	toggleLike: (dishMediaId: string, isLiked: boolean) => void;
	// 保存状態の更新（楽観的更新用）
	toggleSave: (dishMediaId: string, isSaved: boolean) => void;
	// ローカルメディアURIの更新
	setLocalMediaUri: (dishMediaId: string, uri: string, status: DishMediaEntryWithState["localMediaStatus"]) => void;
	// クリア処理
	clearDishes: (key?: string) => void;
};

export const useDishMediaEntriesStore = create<DishMediaEntriesStore>((set, get) => ({
	dishPromisesMap: {},
	dishEntriesById: {},
	
	setDishePromises: (key, items) =>
		set((state) => {
			// #433 【設計】Promise を保存すると同時に、結果を dishEntriesById にも保存
			items.then((dishes) => {
				const newEntriesById = { ...state.dishEntriesById };
				dishes.forEach((dish) => {
					// 既存エントリがあれば状態を維持しつつ更新、なければ新規作成
					const existing = newEntriesById[dish.dish_media.id];
					newEntriesById[dish.dish_media.id] = {
						...dish,
						localMediaUri: existing?.localMediaUri,
						localMediaStatus: existing?.localMediaStatus || "idle",
						isLiked: existing?.isLiked ?? dish.dish_media.isLiked,
						isSaved: existing?.isSaved ?? dish.dish_media.isSaved,
					};
				});
				set({ dishEntriesById: newEntriesById });
			}).catch((error) => {
				console.error("Failed to process dish promises:", error);
			});
			
			return {
				dishPromisesMap: {
					...state.dishPromisesMap,
					[key]: items,
				},
			};
		}),
	
	setDishEntry: (dishMediaId, entry) =>
		set((state) => ({
			dishEntriesById: {
				...state.dishEntriesById,
				[dishMediaId]: {
					...entry,
					localMediaUri: state.dishEntriesById[dishMediaId]?.localMediaUri,
					localMediaStatus: state.dishEntriesById[dishMediaId]?.localMediaStatus || "idle",
					isLiked: state.dishEntriesById[dishMediaId]?.isLiked ?? entry.dish_media.isLiked,
					isSaved: state.dishEntriesById[dishMediaId]?.isSaved ?? entry.dish_media.isSaved,
				},
			},
		})),
	
	updateDishEntry: (dishMediaId, updates) =>
		set((state) => {
			const existing = state.dishEntriesById[dishMediaId];
			if (!existing) return state;
			
			return {
				dishEntriesById: {
					...state.dishEntriesById,
					[dishMediaId]: {
						...existing,
						...updates,
					},
				},
			};
		}),
	
	toggleLike: (dishMediaId, isLiked) =>
		set((state) => {
			const existing = state.dishEntriesById[dishMediaId];
			if (!existing) return state;
			
			// #433 【設計】楽観的更新：即座に liked 状態を反転し、likeCount を増減
			const likeCountDelta = isLiked ? 1 : -1;
			return {
				dishEntriesById: {
					...state.dishEntriesById,
					[dishMediaId]: {
						...existing,
						isLiked,
						dish_media: {
							...existing.dish_media,
							isLiked,
							likeCount: Math.max(0, existing.dish_media.likeCount + likeCountDelta),
						},
					},
				},
			};
		}),
	
	toggleSave: (dishMediaId, isSaved) =>
		set((state) => {
			const existing = state.dishEntriesById[dishMediaId];
			if (!existing) return state;
			
			// #433 【設計】楽観的更新：即座に saved 状態を反転
			return {
				dishEntriesById: {
					...state.dishEntriesById,
					[dishMediaId]: {
						...existing,
						isSaved,
						dish_media: {
							...existing.dish_media,
							isSaved,
						},
					},
				},
			};
		}),
	
	setLocalMediaUri: (dishMediaId, uri, status = "ready") =>
		set((state) => {
			const existing = state.dishEntriesById[dishMediaId];
			if (!existing) return state;
			
			return {
				dishEntriesById: {
					...state.dishEntriesById,
					[dishMediaId]: {
						...existing,
						localMediaUri: uri,
						localMediaStatus: status,
					},
				},
			};
		}),
	
	clearDishes: (key) =>
		set((state) => {
			if (!key) return { dishPromisesMap: {}, dishEntriesById: {} };
			const newMap = { ...state.dishPromisesMap };
			delete newMap[key];
			return { dishPromisesMap: newMap };
		}),
}));
