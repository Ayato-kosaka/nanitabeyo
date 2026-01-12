import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Text } from "react-native";
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
import type { CreateRestaurantDto } from "@shared/api/v1/dto";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { SelectedRestaurantDetails } from "@/features/review/components/SelectedRestaurantDetails";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import MapViewClass from "react-native-maps";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SelectRestaurantScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const [selectedPlace, setSelectedPlace] = useState<QueryRestaurantsResponse[number] | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [isLoadingRestaurantCreation, setIsLoadingRestaurantCreation] = useState(false);
	const {
		BlurModal: RestaurantBlurModal,
		open: openRestaurantModal,
		close: closeRestaurantModal,
	} = useBlurModal({ intensity: 100 });

	const { getLocationDetails, getCurrentLocation } = useLocationSearch();

	// #644 【設計】MapView のアニメーションを制御するための ref
	const mapRef = useRef<MapViewClass>(null);
	// 現在の地図の表示領域
	const currentRegion = useRef<Region>({
		latitude: 35.6762,
		longitude: 139.6503,
		latitudeDelta: 0.01,
		longitudeDelta: 0.01,
	});

	useEffect(() => {
		// #644 【設計】Screen view logging for review restaurant selection
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: { screen: "review_select_restaurant" },
		});

		getCurrentLocation().then(({ location }) => {
			const newRegion = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			currentRegion.current = newRegion;
			mapRef.current?.animateToRegion(newRegion, 1000);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Handle region change with debouncing
	const handleRegionChangeComplete = useCallback((region: Region) => {
		currentRegion.current = region;
	}, []);

	// #644 【設計】レストラン作成＆詳細モーダル表示を行う関数
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

	// #644 【設計】POI押下時にレストラン情報を取得してモーダル表示
	const handlePoiPress = useCallback(
		async (event: PoiClickEvent) => {
			lightImpact();
			createAndOpenRestaurant(event.nativeEvent.placeId);
		},
		[createAndOpenRestaurant, lightImpact],
	);

	// #644 【設計】オートコンプリート選択時の処理
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
		<SafeAreaView edges={["top"]} style={styles.container}>
			{/* #644 【設計】画面タイトル */}
			<View style={styles.headerContainer}>
				<Text style={styles.headerTitle}>{i18n.t("Review.selectRestaurant.title")}</Text>
			</View>

			{/* Map */}
			<MapView
				ref={mapRef}
				style={styles.map}
				onRegionChangeComplete={handleRegionChangeComplete}
				onPoiClick={handlePoiPress}
			/>

			{/* POI Loading Indicator */}
			{isLoadingRestaurantCreation && (
				<View style={styles.loadingOverlay}>
					<ActivityIndicator size="large" color="#5EA2FF" />
				</View>
			)}

			{/* #644 【設計】Search Bar - placeholder: "店名やエリアで検索" */}
			<View style={styles.searchContainer}>
				<LocationAutocomplete
					value={searchQuery}
					onChangeText={setSearchQuery}
					onSelectSuggestion={handleAutocompleteSelect}
					onClear={() => setSearchQuery("")}
					placeholder={i18n.t("Map.placeholders.searchRestaurantsForReview")}
					renderInputRight={
						<TouchableOpacity style={styles.currentLocationButton} onPress={handleCurrentLocation}>
							<Navigation size={20} color="#5EA2FF" />
						</TouchableOpacity>
					}
				/>
			</View>

			<RestaurantBlurModal contentContainerStyle={{ height: "90%" }}>
				{selectedPlace && <SelectedRestaurantDetails restaurant={selectedPlace.restaurant} meta={selectedPlace.meta} />}
			</RestaurantBlurModal>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
	headerContainer: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		backgroundColor: "#FFFFFF",
		paddingVertical: 16,
		paddingHorizontal: 16,
		borderBottomWidth: 1,
		borderBottomColor: "#E5E7EB",
		zIndex: 100,
	},
	headerTitle: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
	},
	map: {
		flex: 1,
	},
	searchContainer: {
		position: "absolute",
		top: 70,
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
