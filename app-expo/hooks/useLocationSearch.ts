import { useState, useCallback } from "react";
import { mockPlacePredictions } from "@/data/searchMockData";
import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import * as Location from "expo-location";
import type { QueryAutocompleteLocationsDto } from "@shared/api/v1/dto";
import type { AutocompleteLocationsResponse, AutocompleteLocation } from "@shared/api/v1/res";
import { SearchParams } from "@/types/search";
import i18n from "@/lib/i18n";


export const useLocationSearch = () => {
	const [suggestions, setSuggestions] = useState<AutocompleteLocation[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

	const searchLocations = useCallback(
		async (query: string) => {
			if (query.length < 2) {
				setSuggestions([]);
				return;
			}

			setIsSearching(true);

			logFrontendEvent({
				event_name: "location_search_started",
				error_level: "debug",
				payload: { query, queryLength: query.length, locale },
			});

			try {
				// Call the real API endpoint
				const placesResponse = await callBackend<QueryAutocompleteLocationsDto, AutocompleteLocationsResponse>(
					"v1/locations/autocomplete",
					{
						method: "GET",
						requestPayload: {
							q: query,
							languageCode: locale,
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
		[callBackend, locale, logFrontendEvent],
	);

	const getLocationDetails = useCallback(async (prediction: AutocompleteLocation): Promise<Pick<SearchParams, 'address' | 'latitude' | 'longitude'>> => {
		// Mock location details - in real app, use Google Places Details API
		const mockLocationDetail: Pick<SearchParams, 'latitude' | 'longitude'> = {
			latitude: 35.658,
			longitude: 139.7016,
		};

		return (
			{
				...mockLocationDetail,
				address: prediction.mainText,
			}
		);
	}, []);

	const getCurrentLocation = useCallback(async (): Promise<Pick<SearchParams, 'address' | 'latitude' | 'longitude'>> => {
		logFrontendEvent({
			event_name: "current_location_fetch_started",
			error_level: "debug",
			payload: {},
		});

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
				latitude,
				longitude,
				address,
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
