import { useState, useCallback } from "react";
import { useAPICall } from "@/hooks/useAPICall";
import type {
	QueryRestaurantsDto,
	CreateRestaurantDto,
	QueryRestaurantDishMediaDto,
	QueryRestaurantsByGooglePlaceIdDto,
} from "@shared/api/v1/dto";
import type {
	QueryRestaurantsResponse,
	CreateRestaurantResponse,
	QueryRestaurantDishMediaResponse,
	QueryRestaurantsByGooglePlaceIdResponse,
} from "@shared/api/v1/res";

/**
 * レストラン関連の API 呼び出しフック
 * 
 * - レストラン検索（地理座標ベース）
 * - Google Place ID によるレストラン作成・取得
 * - レストランの料理投稿一覧取得
 */
export const useRestaurantAPI = () => {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { callBackend } = useAPICall();

	/**
	 * 座標周辺のレストラン検索
	 */
	const searchRestaurants = useCallback(
		async (params: QueryRestaurantsDto): Promise<QueryRestaurantsResponse> => {
			setIsLoading(true);
			setError(null);
			try {
				const response = await callBackend<QueryRestaurantsDto, QueryRestaurantsResponse>(
					"/v1/restaurants/search",
					{
						method: "GET",
						requestPayload: params,
					}
				);
				return response;
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error";
				setError(errorMessage);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[callBackend]
	);

	/**
	 * Google Place ID でレストラン作成
	 */
	const createRestaurant = useCallback(
		async (data: CreateRestaurantDto): Promise<CreateRestaurantResponse> => {
			setIsLoading(true);
			setError(null);
			try {
				const response = await callBackend<CreateRestaurantDto, CreateRestaurantResponse>(
					"/v1/restaurants",
					{
						method: "POST",
						requestPayload: data,
					}
				);
				return response;
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error";
				setError(errorMessage);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[callBackend]
	);

	/**
	 * Google Place ID でレストラン取得
	 */
	const getRestaurantByGooglePlaceId = useCallback(
		async (params: QueryRestaurantsByGooglePlaceIdDto): Promise<QueryRestaurantsByGooglePlaceIdResponse | null> => {
			setIsLoading(true);
			setError(null);
			try {
				const response = await callBackend<QueryRestaurantsByGooglePlaceIdDto, QueryRestaurantsByGooglePlaceIdResponse | null>(
					"/v1/restaurants/by-google-place-id",
					{
						method: "GET",
						requestPayload: params,
					}
				);
				return response;
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error";
				setError(errorMessage);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[callBackend]
	);

	/**
	 * レストランの料理投稿一覧取得
	 */
	const getRestaurantDishMedia = useCallback(
		async (restaurantId: string, params: QueryRestaurantDishMediaDto): Promise<QueryRestaurantDishMediaResponse> => {
			setIsLoading(true);
			setError(null);
			try {
				const response = await callBackend<QueryRestaurantDishMediaDto, QueryRestaurantDishMediaResponse>(
					`/v1/restaurants/${restaurantId}/dish-media`,
					{
						method: "GET",
						requestPayload: params,
					}
				);
				return response;
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error";
				setError(errorMessage);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[callBackend]
	);

	return {
		searchRestaurants,
		createRestaurant,
		getRestaurantByGooglePlaceId,
		getRestaurantDishMedia,
		isLoading,
		error,
	};
};