import type { BulkImportDishesDto, SearchDishMediaDto } from "@shared/api/v1/dto";
import type { BulkImportDishesResponse, DishMediaEntry, SearchDishMediaResponse } from "@shared/api/v1/res";
import { getRemoteConfig } from "@/lib/remoteConfig";
import { DEFAULT_PRICE_LEVELS, DEFAULT_SEARCH_RADIUS } from "@/features/topics/constants";
import { isNoPriceLevelsSelected } from "@/features/search/constants";

type CallBackend = <TRequest extends Record<string, any> | FormData, R>(
	endpointName: string,
	options: {
		method?: "GET" | "POST" | "PATCH" | "DELETE";
		requestPayload: TRequest;
		isMultipart?: boolean;
	},
) => Promise<R>;

/**
 * 店舗検索・店舗候補の初回 import を 1 か所にまとめる。
 *
 * 既存 dish_media が 1 件でもあればその結果を返し、0 件の時だけ bulk import へ進む。
 * これを topics / group vote で共通利用する。
 */
export async function createDishItemsForCategory({
	callBackend,
	categoryId,
	categoryName,
	latitude,
	longitude,
	searchLocationLanguageCode,
	radius = DEFAULT_SEARCH_RADIUS,
	priceLevels = [...DEFAULT_PRICE_LEVELS],
	searchResultRestaurantsNumber = parseInt(getRemoteConfig()?.v1_search_result_restaurants_number!, 10),
}: {
	callBackend: CallBackend;
	categoryId: string;
	categoryName: string;
	latitude: number;
	longitude: number;
	searchLocationLanguageCode: string;
	radius?: number;
	priceLevels?: string[];
	searchResultRestaurantsNumber?: number;
}): Promise<DishMediaEntry[]> {
	// まず既存の dish_media を検索する。0 件の時だけ import に進む。
	const dishItems = await callBackend<SearchDishMediaDto, SearchDishMediaResponse>("v1/dish-media/search", {
		method: "GET",
		requestPayload: {
			location: `${latitude},${longitude}`,
			radius,
			categoryId,
			limit: searchResultRestaurantsNumber,
			// #817 【設計】検索地点の言語のレビューを優先表示する。
			preferredLanguageCode: searchLocationLanguageCode,
		},
	});

	if (dishItems.length > 0) {
		return dishItems.slice(0, searchResultRestaurantsNumber);
	}

	const requestPayload: BulkImportDishesDto = {
		location: `${latitude},${longitude}`,
		radius,
		categoryId,
		categoryName,
		minRating: 3.0,
		languageCode: searchLocationLanguageCode,
		// #876 以下の仕様で priceLevels を送る。
		// - 初期値 []: priceLevels を送らない
		// - 全部チェック: priceLevels を送る
		// - 一部チェック: priceLevels を送る
		...(isNoPriceLevelsSelected(priceLevels) ? {} : { priceLevels }),
	};

	const importResponse = await callBackend<BulkImportDishesDto, BulkImportDishesResponse>("v1/dishes/bulk-import", {
		method: "POST",
		requestPayload,
	});

	return dishItems
		.concat(
			importResponse.filter(
				(imported) =>
					!dishItems.find((existing) => existing.restaurant.google_place_id === imported.restaurant.google_place_id),
			),
		)
		.slice(0, searchResultRestaurantsNumber);
}
