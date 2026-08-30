import { useCallback } from "react";
import { asApiList } from "@/lib/apiList";

import { useAPICall } from "@/hooks/useAPICall";
import type { QueryRestaurantDishMediaDto } from "@shared/api/v1/dto";
import type { QueryRestaurantDishMediaResponse } from "@shared/api/v1/res";

/**
 * 🍽 店舗の料理メディア（`GET v1/restaurants/:id/dish-media`）を
 * `useDishMediaEntriesStore` のページネーション API へ渡す形で引く fetcher。
 *
 * #1386 【設計】店詳細のレビュータブ（`features/map/components/tabs/RestaurantReviewsTab.tsx`）と、
 * そこから開くフィードのルート（`app/[locale]/restaurant/[restaurantId]/feed.tsx`）の
 * 2 箇所で必要になったので切り出した。フィードはルートなので **URL 直リンク / リロードで
 * 単独で着地しうる**（旧実装は BlurModal で、常にレビュータブが先に読み込んでいた）。
 * その場合はフィード側が自分で初回読み込みを行う必要があり、同じキー・同じエンドポイントで
 * 引くことを 1 箇所で担保したい。
 *
 * 返り値は `useCallback` で restaurantId ごとに安定する（`fetchInitialByKey` の依存に置ける）。
 */
export function useRestaurantDishMediaFetcher(restaurantId: string) {
	const { callBackend } = useAPICall();

	return useCallback(
		async ({ cursor }: { cursor?: string | null }) => {
			const response = await callBackend<QueryRestaurantDishMediaDto, QueryRestaurantDishMediaResponse>(
				`v1/restaurants/${restaurantId}/dish-media`,
				{
					method: "GET",
					requestPayload: cursor ? { cursor } : {},
				},
			);
			return {
				data: asApiList(response.data),
				nextCursor: response.nextCursor,
			};
		},
		[callBackend, restaurantId],
	);
}
