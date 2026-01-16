import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Navigation } from "lucide-react-native";
import MapView, { Region } from "@/components/MapView";
import type { PoiClickEvent } from "react-native-maps";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import {
	type AutocompleteLocation,
	type QueryRestaurantsResponse,
	type CreateRestaurantResponse,
	ErrorCode,
} from "@shared/api/v1/res";
import type { QueryRestaurantsDto, CreateRestaurantDto } from "@shared/api/v1/dto";
import { AvatarBubbleMarkerBitmap } from "@/features/mapMarkers";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { SelectedRestaurantDetails } from "@/features/map/components/SelectedRestaurantDetails";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import { PrimaryButton } from "@/components/PrimaryButton";
import MapViewClass from "react-native-maps";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { useSnackbar } from "@/contexts/SnackbarProvider";

export default function MapScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const [selectedPlace, setSelectedPlace] = useState<QueryRestaurantsResponse[number] | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [restaurants, setRestaurants] = useState<QueryRestaurantsResponse>([]);
	const [isLoadingNearbyRestaurants, setIsLoadingNearbyRestaurants] = useState(false);
	const [isLoadingRestaurantCreation, setIsLoadingRestaurantCreation] = useState(false);
	const {
		BlurModal: RestaurantBlurModal,
		open: openRestaurantModal,
		close: closeRestaurantModal,
	} = useBlurModal({ intensity: 100 });

	const { getLocationDetails, getCurrentLocation } = useLocationSearch();

	// MapView のアニメーションを制御するための ref
	const mapRef = useRef<MapViewClass>(null);
	// 現在の地図の表示領域
	const currentRegion = useRef<Region>({
		latitude: 35.6762,
		longitude: 139.6503,
		latitudeDelta: 0.01,
		longitudeDelta: 0.01,
	});

	// Search nearby restaurants when region changes
	const searchNearbyRestaurants = useCallback(
		async (region: Region) => {
			if (isLoadingNearbyRestaurants) return;

			setIsLoadingNearbyRestaurants(true);
			try {
				const results = await callBackend<QueryRestaurantsDto, QueryRestaurantsResponse>("v1/restaurants/search", {
					method: "GET",
					requestPayload: {
						lat: region.latitude,
						lng: region.longitude,
						radius: Math.max(region.latitudeDelta, region.longitudeDelta) * 50000, // Approximate radius based on map view
						limit: 16,
					},
				});
				setRestaurants(results);
				logFrontendEvent({
					event_name: "restaurant_search_success",
					error_level: "log",
					payload: { count: results.length, lat: region.latitude, lng: region.longitude },
				});
			} catch (error) {
				logFrontendEvent({
					event_name: "restaurant_search_error",
					error_level: "error",
					payload: { error, lat: region.latitude, lng: region.longitude },
				});
			} finally {
				setIsLoadingNearbyRestaurants(false);
			}
		},
		[callBackend, isLoadingNearbyRestaurants, logFrontendEvent],
	);

	useEffect(() => {
		getCurrentLocation().then(({ location }) => {
			const newRegion = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			currentRegion.current = newRegion;
			mapRef.current?.animateToRegion(newRegion, 1000);
			// Search restaurants at current location
			searchNearbyRestaurants(newRegion);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Handle region change with debouncing
	const handleRegionChangeComplete = useCallback((region: Region) => {
		currentRegion.current = region;
	}, []);

	// 独自のマーカー押下時にレストラン詳細モーダルを表示
	const handleMarkerPress = useCallback(
		(pressedPlace: QueryRestaurantsResponse[number]) => {
			lightImpact();
			setSelectedPlace(pressedPlace);
			openRestaurantModal();
		},
		[lightImpact, openRestaurantModal],
	);

	// レストラン作成＆詳細モーダル表示を行う関数
	// #525 【設計】エラーハンドリングを整備し、422/404/network_error 等を適切にスナックバーで通知
	const createAndOpenRestaurant = useCallback(
		async (googlePlaceId: string) => {
			setIsLoadingRestaurantCreation(true);
			try {
				const response = await callBackend<CreateRestaurantDto, CreateRestaurantResponse>("v1/restaurants", {
					method: "POST",
					requestPayload: { googlePlaceId },
				});
				setSelectedPlace(response);
				openRestaurantModal();
			} catch (rawError: unknown) {
				const error = rawError as ApiError;

				// 422 + PLACE_NOT_FOOD_AND_DRINK: レストランではない Place
				if (error.status === 422 && error.errorCode === ErrorCode.PLACE_NOT_FOOD_AND_DRINK) {
					showSnackbar(i18n.t("Map.errors.placeNotRestaurant"));
					return;
				}

				// 404: Place が見つからない
				if (error.status === 404) {
					showSnackbar(i18n.t("Map.errors.placeNotFound"));
					return;
				}

				// ネットワークエラー
				if (error.code === "network_error" || error.status === 0) {
					showSnackbar(i18n.t("Common.errors.network"));
				} else {
					// その他のエラー（http_error / api_error / invalid_response など）
					showSnackbar(i18n.t("Common.errors.unexpected"));
				}

				logFrontendEvent({
					event_name: "poi_press_error",
					error_level: "error",
					payload: { error, googlePlaceId },
				});
			} finally {
				setIsLoadingRestaurantCreation(false);
			}
		},
		[callBackend, logFrontendEvent, openRestaurantModal, showSnackbar],
	);

	// POI押下時にレストラン情報を取得してモーダル表示
	const handlePoiPress = useCallback(
		async (event: PoiClickEvent) => {
			lightImpact();
			createAndOpenRestaurant(event.nativeEvent.placeId);
		},
		[createAndOpenRestaurant, lightImpact],
	);

	// オートコンプリート選択時の処理
	const handleAutocompleteSelect = useCallback(
		async (prediction: AutocompleteLocation) => {
			lightImpact();
			if (isFoodAndDrinkPlaceForUser(prediction)) {
				// 飲食店カテゴリの場合はレストラン作成＆詳細表示
				createAndOpenRestaurant(prediction.place_id);
			} else {
				// 一般の場所の場合は地図移動のみ
				try {
					const { location } = await getLocationDetails(prediction);
					const newRegion = {
						latitude: location.latitude,
						longitude: location.longitude,
						latitudeDelta: 0.01,
						longitudeDelta: 0.01,
					};
					currentRegion.current = newRegion;
					mapRef.current?.animateToRegion(newRegion, 1000);
					setSearchQuery("");
				} catch (error) {
					logFrontendEvent({
						event_name: "MapSearchError",
						error_level: "error",
						payload: { error, prediction },
					});
				}
			}
		},
		[createAndOpenRestaurant, getLocationDetails, lightImpact, logFrontendEvent],
	);

	const handleCurrentLocation = useCallback(async () => {
		lightImpact();
		try {
			const { location } = await getCurrentLocation();
			const newRegion = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			currentRegion.current = newRegion;
			mapRef.current?.animateToRegion(newRegion, 1000);
		} catch (error) {
			logFrontendEvent({
				event_name: "MapCurrentLocationError",
				error_level: "error",
				payload: { error },
			});
		}
	}, [getCurrentLocation, lightImpact, logFrontendEvent]);

	return (
		<View style={styles.container}>
			{/* Map */}
			<MapView
				ref={mapRef}
				style={styles.map}
				onRegionChangeComplete={handleRegionChangeComplete}
				onPoiClick={handlePoiPress}>
				{restaurants.map((restaurantData: QueryRestaurantsResponse[number]) => (
					<AvatarBubbleMarkerBitmap
						key={restaurantData.restaurant.id}
						coordinate={{
							latitude: restaurantData.restaurant.latitude,
							longitude: restaurantData.restaurant.longitude,
						}}
						onPress={() => handleMarkerPress(restaurantData)}
						color="#FFF"
						uri={restaurantData.restaurant.imageUrls?.sm}
					/>
				))}
			</MapView>

			{/* POI Loading Indicator */}
			{isLoadingRestaurantCreation && (
				<View style={styles.loadingOverlay}>
					<ActivityIndicator size="large" color="#5EA2FF" />
				</View>
			)}

			{/* Search Bar */}
			<View style={styles.searchContainer}>
				<LocationAutocomplete
					value={searchQuery}
					onChangeText={setSearchQuery}
					onSelectSuggestion={handleAutocompleteSelect}
					onClear={() => setSearchQuery("")}
					placeholder={i18n.t("Map.placeholders.searchRestaurants")}
					renderInputRight={
						<TouchableOpacity style={styles.currentLocationButton} onPress={handleCurrentLocation}>
							<Navigation size={20} color="#5EA2FF" />
						</TouchableOpacity>
					}
				/>
			</View>

			{/* Search This Area Button */}
			<View style={styles.bottomActionContainer}>
				<PrimaryButton
					label={i18n.t("Map.buttons.searchNearby")}
					onPress={() => searchNearbyRestaurants(currentRegion.current)}
					colors={["#ffffff", "#ffffff"]}
					shadowColor={"#000000"}
					labelStyle={{ color: "#1A1A1A" }}
					loading={isLoadingNearbyRestaurants}
				/>
			</View>

			<RestaurantBlurModal contentContainerStyle={{ height: "90%" }}>
				{selectedPlace && <SelectedRestaurantDetails restaurant={selectedPlace.restaurant} meta={selectedPlace.meta} />}
			</RestaurantBlurModal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
	map: {
		flex: 1,
	},
	searchContainer: {
		position: "absolute",
		top: 50,
		left: 16,
		right: 16,
		zIndex: 10,
	},
	bottomActionContainer: {
		position: "absolute",
		bottom: 20,
		left: 16,
		right: 16,
		zIndex: 10,
	},
	currentLocationButton: {
		padding: 16,
		borderLeftWidth: 0.5,
		borderLeftColor: "#E5E7EB",
	},
	loadingOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.3)",
		zIndex: 20,
	},
});
