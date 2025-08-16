import { useState, useCallback, useRef } from "react";
import { mockPlacePredictions } from "@/data/searchMockData";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import * as Location from "expo-location";
import { v4 as uuidv4, parse as uuidParse } from "uuid";
import { encode as b64encode } from "base-64";
import type { QueryAutocompleteLocationsDto, QueryLocationDetailsDto } from "@shared/api/v1/dto";
import type { AutocompleteLocationsResponse, AutocompleteLocation, LocationDetailsResponse } from "@shared/api/v1/res";
import { SearchParams } from "@/types/search";
import i18n from "@/lib/i18n";

export const useLocationSearch = () => {
	const [suggestions, setSuggestions] = useState<AutocompleteLocation[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

	// Session token for Google Places API
	const sessionTokenRef = useRef<string | null>(null);

	/**
	 * Generate a URL/filename safe Base64 encoded UUIDv4 session token
	 */
	const generateSessionToken = useCallback((): string => {
		// uuidParse は UUID 文字列を 16 byte の Uint8Array に変換
		const bytes = uuidParse(uuidv4());
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
	const getSessionToken = useCallback((): string => {
		console.log("Getting session token ", sessionTokenRef.current);
		if (!sessionTokenRef.current) {
			sessionTokenRef.current = generateSessionToken();
		}
		return sessionTokenRef.current;
	}, [generateSessionToken]);

	/**
	 * Clear session token (called after place details request)
	 */
	const clearSessionToken = useCallback(() => {
		sessionTokenRef.current = null;
	}, []);

	const searchLocations = useCallback(
		async (query: string) => {
			if (query.length < 2) {
				setSuggestions([]);
				return;
			}

			setIsSearching(true);

			try {
				// Call the real API endpoint with session token
				const placesResponse = await callBackend<QueryAutocompleteLocationsDto, AutocompleteLocationsResponse>(
					"v1/locations/autocomplete",
					{
						method: "GET",
						requestPayload: {
							q: query,
							languageCode: locale,
							sessionToken: getSessionToken(),
						},
					},
				);

				// Use API response directly
				setSuggestions(placesResponse);

				logFrontendEvent({
					event_name: "location_search_success",
					error_level: "log",
					payload: {
						query,
						resultCount: placesResponse.length,
						hasResults: placesResponse.length > 0,
					},
				});

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
				console.error("Location search error:", error);
				setSuggestions([]);

				logFrontendEvent({
					event_name: "location_search_failed",
					error_level: "error",
					payload: { query, error: String(error) },
				});
			} finally {
				setIsSearching(false);
			}
		},
		[callBackend, locale, logFrontendEvent, getSessionToken],
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
						error: String(error),
					},
				});

				throw error;
			}
		},
		[callBackend, logFrontendEvent, clearSessionToken],
	);

	const getCurrentLocation = useCallback(async (): Promise<
		Pick<SearchParams, "address" | "location" | "regionCode">
	> => {
		try {
			const { status } = await Location.requestForegroundPermissionsAsync();
			if (status !== "granted") {
				logFrontendEvent({
					event_name: "current_location_permission_denied",
					error_level: "warn",
					payload: {},
				});
			}

			const position = await Location.getCurrentPositionAsync({
				accuracy: Location.Accuracy.Balanced,
			});
			const { latitude, longitude } = position.coords;

			let address = `${i18n.t("Map.currentLocation")} (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
			try {
				const results = await Location.reverseGeocodeAsync({ latitude, longitude });
				if (results && results.length > 0) {
					const r = results[0];
					address = r.city || address;
				}
			} catch {
				logFrontendEvent({
					event_name: "current_location_reverse_geocode_failed",
					error_level: "warn",
					payload: { latitude, longitude },
				});
			}

			logFrontendEvent({
				event_name: "current_location_fetch_success",
				error_level: "log",
				payload: { hasLocation: true },
			});

			return {
				location: position.coords,
				address,
				regionCode: locale.split("-")[1],
			};
		} catch (error) {
			logFrontendEvent({
				event_name: "current_location_fetch_failed",
				error_level: "error",
				payload: { error: String(error) },
			});
			throw error;
		}
	}, [logFrontendEvent]);

	return {
		suggestions,
		isSearching,
		searchLocations,
		getCurrentLocation,
		getLocationDetails,
	};
};
