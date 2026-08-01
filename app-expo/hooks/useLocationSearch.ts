import { useState, useCallback, useRef } from "react";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogString } from "@/lib/errorMessage";
import * as Location from "expo-location";
// #932 【設計】現在地の緯度経度取得だけは native(expo-location) と web(navigator.geolocation) で
// 実装を分ける必要があるため、この1関数だけを .ts / .web.ts に分離して import する
// (Metro が拡張子で自動解決する)。それ以外の検索・キャッシュ・逆ジオコーディング処理は
// 完全に共通のため、このファイル自体は分割しない。
import { getCurrentLocationPosition } from "./useCurrentLocationPosition";
import { LocationPermissionError } from "./locationPermissionError";
import { getRandomBytesAsync } from "expo-crypto";
import { encode as b64encode } from "base-64";
import type {
	QueryAutocompleteLocationsDto,
	QueryLocationDetailsDto,
	QueryReverseGeocodingDto,
} from "@shared/api/v1/dto";
import type {
	AutocompleteLocationsResponse,
	AutocompleteLocation,
	LocationDetailsResponse,
	LocationReverseGeocodingResponse,
} from "@shared/api/v1/res";
import { SearchParams } from "@/types/search";
import i18n from "@/lib/i18n";

// #931 【設計】地点候補検索の状態を明示的に分離する。
// "debouncing" は呼び出し元(LocationAutocomplete)がデバウンス待機中に採用する値で、
// このHook自身は "idle"(未検索) → "searching"(API呼び出し中) → "success" / "empty" / "error" のみ遷移する。
export type LocationSearchStatus = "idle" | "debouncing" | "searching" | "success" | "empty" | "error";

export const useLocationSearch = () => {
	const [suggestions, setSuggestions] = useState<AutocompleteLocation[]>([]);
	const [status, setStatus] = useState<LocationSearchStatus>("idle");
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// #931 【設計】最後に発行したリクエストのみ結果を採用するための単調増加ID。
	// 古い入力に対するレスポンスが後から返ってきても、この値が一致しなければ状態更新を捨てる。
	const latestRequestIdRef = useRef(0);

	// Session token for Google Places API
	const sessionTokenRef = useRef<string | null>(null);

	// Cache for current location to avoid multiple requests
	const currentLocationCache = useRef<(Omit<LocationDetailsResponse, "viewport"> & { timestamp: number }) | null>(null);

	// In-flight request tracking
	const currentLocationPromiseRef = useRef<Promise<Omit<LocationDetailsResponse, "viewport">> | null>(null);

	/**
	 * Generate a URL/filename safe Base64 encoded UUIDv4 session token
	 */
	const generateSessionToken = useCallback(async (): Promise<string> => {
		// uuidParse は UUID 文字列を 16 byte の Uint8Array に変換
		const bytes = await getRandomBytesAsync(16);
		let binary = "";
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		// base-64 パッケージは標準 Base64 (btoa 相当)
		const base64 = b64encode(binary);
		// URL / filename safe 化
		return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
	}, []);

	/**
	 * Get or create session token
	 */
	const getSessionToken = useCallback(async (): Promise<string> => {
		if (!sessionTokenRef.current) {
			sessionTokenRef.current = await generateSessionToken();
		}
		return sessionTokenRef.current;
	}, [generateSessionToken]);

	/**
	 * Clear session token (called after place details request)
	 */
	const clearSessionToken = useCallback(() => {
		sessionTokenRef.current = null;
	}, []);

	// #931 【設計】候補・状態を初期化する。クリア操作や1文字未満への削除時に呼び出し、
	// 「表示フラグだけ畳んで suggestions は残る」という旧実装の不整合(再入力で旧候補が再表示される)を解消する。
	// 発行済みの request id を無効化するため、in-flight のレスポンスが後から届いても反映されない。
	const clearSuggestions = useCallback(() => {
		latestRequestIdRef.current += 1;
		setSuggestions([]);
		setStatus("idle");
	}, []);

	const searchLocations = useCallback(
		async (query: string) => {
			if (query.length < 1) {
				clearSuggestions();
				return;
			}

			// #931 【設計】このリクエストの identity を確保。完了時に最新でなければ結果を捨てる。
			const requestId = ++latestRequestIdRef.current;
			setStatus("searching");

			try {
				// Call the real API endpoint with session token
				const placesResponse = await callBackend<QueryAutocompleteLocationsDto, AutocompleteLocationsResponse>(
					"v1/locations/autocomplete",
					{
						method: "GET",
						requestPayload: {
							q: query,
							languageCode: locale,
							sessionToken: await getSessionToken(),
						},
					},
				);

				// #931 【設計】デバウンス+ネットワーク遅延により、古い入力のレスポンスが
				// 新しい入力のレスポンスより後に届くレースがありうる。最新リクエストでなければ無視する。
				if (latestRequestIdRef.current !== requestId) return;

				setSuggestions(placesResponse);
				setStatus(placesResponse.length > 0 ? "success" : "empty");

				// Keep mock implementation as fallback (commented out as requested)
				// // Simulate API delay
				// await new Promise((resolve) => setTimeout(resolve, 300));
				// // Filter mock data based on query
				// const filtered = mockPlacePredictions.filter(
				// 	(prediction) =>
				// 		prediction.text.toLowerCase().includes(query.toLowerCase()) ||
				// 		prediction.mainText.toLowerCase().includes(query.toLowerCase()),
				// );
				// setSuggestions(filtered);
			} catch (error) {
				if (latestRequestIdRef.current !== requestId) return;

				console.error("Location search error:", error);
				setSuggestions([]);
				setStatus("error");

				logFrontendEvent({
					event_name: "location_search_failed",
					error_level: "error",
					payload: { query, error: toErrorLogString(error) },
				});
			}
		},
		[callBackend, locale, logFrontendEvent, getSessionToken, clearSuggestions],
	);

	const getLocationDetails = useCallback(
		async (prediction: AutocompleteLocation): Promise<LocationDetailsResponse> => {
			try {
				// Call the real API endpoint for location details
				const detailsResponse = await callBackend<QueryLocationDetailsDto, LocationDetailsResponse>(
					"v1/locations/details",
					{
						method: "GET",
						requestPayload: {
							placeId: prediction.place_id,
							languageCode: "en", // Fixed to "en" as per requirements
							sessionToken: sessionTokenRef.current || undefined,
						},
					},
				);

				// Clear session token after use
				clearSessionToken();

				logFrontendEvent({
					event_name: "location_details_success",
					error_level: "log",
					payload: {
						placeId: prediction.place_id,
						hasLocation: true,
					},
				});

				return detailsResponse;
			} catch (error) {
				// Clear session token on error too
				clearSessionToken();

				logFrontendEvent({
					event_name: "location_details_failed",
					error_level: "error",
					payload: {
						placeId: prediction.place_id,
						error: toErrorLogString(error),
					},
				});

				throw error;
			}
		},
		[callBackend, logFrontendEvent, clearSessionToken],
	);

	const getCurrentLocation = useCallback(async (): Promise<Omit<LocationDetailsResponse, "viewport">> => {
		// Cache TTL: 5 minutes (300000 ms)
		const CACHE_TTL = 300000;
		const now = Date.now();

		// Check cache first
		if (currentLocationCache.current && now - currentLocationCache.current.timestamp < CACHE_TTL) {
			logFrontendEvent({
				event_name: "current_location_cache_hit",
				error_level: "log",
				payload: { cached_timestamp: currentLocationCache.current.timestamp },
			});

			// Return cached result without timestamp
			const { timestamp, ...cachedResult } = currentLocationCache.current;
			return cachedResult;
		}

		// Check if there's already an in-flight request
		if (currentLocationPromiseRef.current) {
			logFrontendEvent({
				event_name: "current_location_deduplication",
				error_level: "log",
				payload: {},
			});
			return currentLocationPromiseRef.current;
		}

		// Create new request
		const locationPromise = (async (): Promise<Omit<LocationDetailsResponse, "viewport">> => {
			try {
				// #932 【修正】native/web で実装の異なる権限確認+位置取得を共通の関数に委譲。
				// 失敗理由(denied/timeout/unsupported/unavailable)は LocationPermissionError として分類される
				const { latitude, longitude } = await getCurrentLocationPosition();

				// Call the new reverse geocoding API
				try {
					const reverseGeocodingResponse = await callBackend<
						QueryReverseGeocodingDto,
						LocationReverseGeocodingResponse
					>("v1/locations/reverse-geocoding", {
						method: "GET",
						requestPayload: {
							lat: latitude,
							lng: longitude,
						},
					});

					const result = {
						location: reverseGeocodingResponse.location,
						address: reverseGeocodingResponse.address,
						localLanguageCode: reverseGeocodingResponse.localLanguageCode,
					};

					// Cache the result
					currentLocationCache.current = {
						...result,
						timestamp: now,
					};

					return result;
				} catch (apiError) {
					// Fallback to Expo's reverse geocoding if backend fails
					logFrontendEvent({
						event_name: "current_location_backend_failed_fallback",
						error_level: "warn",
						payload: {
							latitude,
							longitude,
							// #1092 PR4b callBackend の失敗がそのまま来る。PR4a 以降ここには
							// Error ではない ApiError(plain object) も流れるため String() だと "[object Object]" になる。
							// (A) 素の String() だった箇所なので、Error の "Name: message" は保つ側へ寄せる
							error: toErrorLogString(apiError),
						},
					});

					let address = `${i18n.t("Search.currentLocation")} (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
					try {
						const results = await Location.reverseGeocodeAsync({ latitude, longitude });
						if (results && results.length > 0) {
							const r = results[0];
							address = r.city || address;
						}
					} catch {
						logFrontendEvent({
							event_name: "current_location_expo_fallback_failed",
							error_level: "warn",
							payload: { latitude, longitude },
						});
					}

					const fallbackResult = {
						location: { latitude, longitude },
						address,
						localLanguageCode: locale.split("-")[0],
					};

					// Cache the fallback result
					currentLocationCache.current = {
						...fallbackResult,
						timestamp: now,
					};

					return fallbackResult;
				}
			} catch (error) {
				logFrontendEvent({
					event_name: "current_location_fetch_failed",
					error_level: "error",
					payload: {
						error: toErrorLogString(error),
						kind: error instanceof LocationPermissionError ? error.kind : "unavailable",
					},
				});
				throw error;
			} finally {
				// Clear the in-flight reference
				currentLocationPromiseRef.current = null;
			}
		})();

		// Store the promise for deduplication
		currentLocationPromiseRef.current = locationPromise;

		return locationPromise;
	}, [callBackend, logFrontendEvent, locale]);

	return {
		suggestions,
		status,
		searchLocations,
		clearSuggestions,
		getCurrentLocation,
		getLocationDetails,
	};
};
