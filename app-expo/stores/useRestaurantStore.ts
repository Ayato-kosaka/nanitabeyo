import { createWithEqualityFn } from "zustand/traditional";
import type { QueryMeSavedRestaurantsResponse } from "@shared/api/v1/res";

// #644 【設計】レストランエンティティストアのメタ情報
export type RestaurantMeta = {
	reviewCount: number;
	averageRating: number;
	totalCents?: number;
	maxEndDate?: string | null;
	lastSavedAt?: string | null;
};

// #644 【設計】ストアで管理するレストランエントリ（restaurant + meta を統合）
export type RestaurantEntry = {
	restaurant: QueryMeSavedRestaurantsResponse["data"][number]["restaurant"];
	meta: RestaurantMeta;
};

/**
 * #644 【設計】レストラン情報を管理する Entity Store
 * - POST /v1/restaurants のレスポンスをキャッシュ
 * - GET /v1/restaurants/:id のレスポンスをキャッシュ
 * - 保存済みレストラン一覧のキャッシュ
 * - restaurant.id をキーに正規化して保持
 */
export type RestaurantStore = {
	/**
	 * restaurant.id をキーにしたレストラン情報マップ（正規化テーブル）
	 */
	byId: Record<string, RestaurantEntry>;

	/**
	 * 単一レストランを upsert する
	 */
	upsert: (entry: RestaurantEntry) => void;

	/**
	 * 複数レストランを一括 upsert する
	 */
	upsertMany: (entries: RestaurantEntry[]) => void;

	/**
	 * restaurant.id でレストラン情報を取得
	 */
	getById: (id: string) => RestaurantEntry | undefined;

	/**
	 * ストアをクリア（主にテスト用）
	 */
	clear: () => void;
};

export const useRestaurantStore = createWithEqualityFn<RestaurantStore>(
	(set, get) => ({
		byId: {},

		upsert: (entry) => {
			set((state) => ({
				byId: {
					...state.byId,
					[entry.restaurant.id]: entry,
				},
			}));
		},

		upsertMany: (entries) => {
			set((state) => {
				const newById = { ...state.byId };
				entries.forEach((entry) => {
					newById[entry.restaurant.id] = entry;
				});
				return { byId: newById };
			});
		},

		getById: (id) => {
			return get().byId[id];
		},

		clear: () => {
			set({ byId: {} });
		},
	}),
	Object.is,
);
