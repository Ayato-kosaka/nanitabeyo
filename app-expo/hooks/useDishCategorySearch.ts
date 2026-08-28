import { useState, useCallback, useRef } from "react";
import { asApiList } from "@/lib/apiList";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogString } from "@/lib/errorMessage";
import type { QueryDishCategoryVariantsDto, CreateDishCategoryVariantDto } from "@shared/api/v1/dto";
import type { QueryDishCategoryVariantsResponse, CreateDishCategoryVariantResponse } from "@shared/api/v1/res";

/**
 * 料理カテゴリ検索用のHook
 * LocationAutocompleteの実装パターンを踏襲
 */
export const useDishCategorySearch = () => {
	const [suggestions, setSuggestions] = useState<QueryDishCategoryVariantsResponse>([]);
	const [isSearching, setIsSearching] = useState(false);
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// AbortController for canceling in-flight requests
	const abortControllerRef = useRef<AbortController | null>(null);

	/**
	 * 料理カテゴリの候補を検索
	 * デバウンス処理は呼び出し元で行う想定
	 */
	const searchDishCategories = useCallback(
		async (query: string) => {
			// 2文字未満は検索しない
			if (query.length < 2) {
				setSuggestions([]);
				return;
			}

			// 前回のリクエストをキャンセル
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}

			// 新しいAbortControllerを作成
			const controller = new AbortController();
			abortControllerRef.current = controller;

			setIsSearching(true);

			try {
				// API呼び出し: GET /v1/dish-category-variants
				const response = await callBackend<QueryDishCategoryVariantsDto, QueryDishCategoryVariantsResponse>(
					"v1/dish-category-variants",
					{
						method: "GET",
						requestPayload: {
							q: query,
							lang: locale.split("-")[0], // "ja", "en" など
						},
					},
				);

				// リクエストがキャンセルされていない場合のみ結果を設定
				if (!controller.signal.aborted) {
					// #1375 API を信じない。配列でなければ空へ落とす。**state へ入れる前に**通すこと
			// （後で `.length` を読む形だと、`setState` 済みの汚れた値が次のレンダーで爆発する。#1561）
			const rows = asApiList(response);
			setSuggestions(rows);

					logFrontendEvent({
						event_name: "dish_category_search_success",
						error_level: "log",
						payload: { query, resultCount: rows.length },
					});
				}
			} catch (error: any) {
				// AbortErrorは無視
				if (error.name === "AbortError" || controller.signal.aborted) {
					return;
				}

				console.error("Dish category search error:", error);
				setSuggestions([]);

				logFrontendEvent({
					event_name: "dish_category_search_failed",
					error_level: "error",
					payload: { query, error: toErrorLogString(error) },
				});
			} finally {
				if (!controller.signal.aborted) {
					setIsSearching(false);
				}
			}
		},
		[callBackend, locale, logFrontendEvent],
	);

	/**
	 * 料理カテゴリ表記揺れを登録
	 * POST /v1/dish-category-variants
	 * 200/201: 成功
	 * 409: 既存IDとして扱う
	 * それ以外: エラー
	 */
	const createDishCategoryVariant = useCallback(
		async (name: string): Promise<CreateDishCategoryVariantResponse> => {
			try {
				logFrontendEvent({
					event_name: "dish_category_variant_create_start",
					error_level: "log",
					payload: { name },
				});

				// API呼び出し: POST /v1/dish-category-variants
				const response = await callBackend<CreateDishCategoryVariantDto, CreateDishCategoryVariantResponse>(
					"v1/dish-category-variants",
					{
						method: "POST",
						requestPayload: {
							name,
						},
					},
				);

				logFrontendEvent({
					event_name: "dish_category_variant_create_success",
					error_level: "log",
					payload: { name, dishCategoryId: response.id },
				});

				return response;
			} catch (error: any) {
				logFrontendEvent({
					event_name: "dish_category_variant_create_failed",
					error_level: "error",
					payload: { name, error: toErrorLogString(error) },
				});

				throw error;
			}
		},
		[callBackend, logFrontendEvent],
	);

	return {
		suggestions,
		isSearching,
		searchDishCategories,
		createDishCategoryVariant,
	};
};
