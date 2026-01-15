import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Navigation, RotateCw } from "lucide-react-native";
import MapView, { Region } from "@/components/MapView";
import type { PoiClickEvent } from "react-native-maps";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import {
	type AutocompleteLocation,
	type CreateRestaurantResponse,
	type QueryMeSavedRestaurantsResponse,
	ErrorCode,
} from "@shared/api/v1/res";
import type { CreateRestaurantDto, QuerySavedRestaurantsDto } from "@shared/api/v1/dto";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import MapViewClass from "react-native-maps";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { AvatarBubbleMarkerBitmap, MarkerBitmapRendererProvider } from "@/features/mapMarkers";
import { router, useFocusEffect } from "expo-router";
import { SavedRestaurantsSheet, SavedRestaurantsSheetHandle } from "@/features/review/components/SavedRestaurantsSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useRestaurantStore } from "@/features/review/stores/useRestaurantStore";
import { useLocale } from "@/hooks/useLocale";
import { ReviewHeader } from "@/features/review/components/ReviewHeader";

type SavedRestaurant = QueryMeSavedRestaurantsResponse["data"][number];

/**
 * レビュー投稿画面のレストラン選択マップ画面
 * - 地図上のPOIタップ or 検索バーからレストラン選択でレストラン作成＆詳細画面へ遷移
 * - 保存したお店を地図上にマーカー表示、カード表示
 */
export default function SelectRestaurantScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const locale = useLocale();
	const [searchQuery, setSearchQuery] = useState("");
	const [isLoadingRestaurantCreation, setIsLoadingRestaurantCreation] = useState(false);
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

	// Handle region change with debouncing
	const handleRegionChangeComplete = useCallback((region: Region) => {
		currentRegion.current = region;
	}, []);

	// #644 【設計】レストラン作成＆詳細画面へ遷移する関数（ストアにキャッシュ→ナビゲーション）
	// #525 【設計】エラーハンドリングを整備し、422/404/network_error 等を適切にスナックバーで通知
	const createAndOpenRestaurant = useCallback(
		async (googlePlaceId: string) => {
			setIsLoadingRestaurantCreation(true);
			try {
				const response = await callBackend<CreateRestaurantDto, CreateRestaurantResponse>("v1/restaurants", {
					method: "POST",
					requestPayload: { googlePlaceId },
				});

				// #644 【設計】ストアに upsert してから詳細画面へ遷移
				const { upsert } = useRestaurantStore.getState();
				upsert({
					restaurant: response.restaurant,
					meta: response.meta,
				});

				router.push({
					pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]",
					params: { locale, restaurantId: response.restaurant.id },
				});
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
		[callBackend, logFrontendEvent, showSnackbar, locale],
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

	// #644 【設計】保存したお店一覧の BottomSheet 用 ref
	const savedRestaurantsSheetRef = useRef<SavedRestaurantsSheetHandle>(null);
	const isSavedRestaurantsSheetVisibleRef = useRef(false); // #644 【設計】present/dismiss の競合防止用フラグ
	// 画面フォーカスに連動して Sheet を開閉
	useFocusEffect(
		useCallback(() => {
			// フォーカスされたとき → Sheet を表示（重複 present を避ける）
			if (!isSavedRestaurantsSheetVisibleRef.current) {
				isSavedRestaurantsSheetVisibleRef.current = true;
				void savedRestaurantsSheetRef.current?.present();
			}

			// フォーカスが外れたとき（他画面へ遷移など） → Sheet を閉じる（重複 dismiss を避ける）
			return () => {
				if (isSavedRestaurantsSheetVisibleRef.current) {
					isSavedRestaurantsSheetVisibleRef.current = false;
					void savedRestaurantsSheetRef.current?.dismiss();
				}
			};
		}, []),
	);

	// #644 【設計】保存したお店の状態管理
	const [savedRestaurants, setSavedRestaurants] = useState<QueryMeSavedRestaurantsResponse["data"]>([]);
	const [isLoadingSavedRestaurants, setIsLoadingSavedRestaurants] = useState(false);
	const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);

	// #644 【設計】保存したお店を現在地で検索
	const searchSavedRestaurants = useCallback(
		async (region: Region) => {
			if (isLoadingSavedRestaurants) return;

			lightImpact();
			setIsLoadingSavedRestaurants(true);

			try {
				const response = await callBackend<QuerySavedRestaurantsDto, QueryMeSavedRestaurantsResponse>(
					"v1/users/me/saved-restaurants",
					{
						method: "GET",
						requestPayload: {
							lat: currentRegion.current.latitude,
							lng: currentRegion.current.longitude,
							radius: Math.max(region.latitudeDelta, region.longitudeDelta) * 50000,
							limit: 20,
						},
					},
				);

				setSavedRestaurants(response.data);
				setActiveRestaurantId(null);
			} catch (error) {
				showSnackbar(i18n.t("Review.selectRestaurant.fetchSavedRestaurantsError"));
				logFrontendEvent({
					event_name: "saved_restaurants_search_error",
					error_level: "error",
					payload: { error },
				});
			} finally {
				setIsLoadingSavedRestaurants(false);
			}
		},
		[callBackend, currentRegion, isLoadingSavedRestaurants, lightImpact, logFrontendEvent, showSnackbar],
	);

	// #644 【設計】保存したお店のマーカー押下時の処理（ストア upsert → 遷移）
	const handleSavedRestaurantMarkerPress = useCallback(
		(restaurant: SavedRestaurant) => {
			lightImpact();

			const index = savedRestaurants.findIndex((r) => r.restaurant.id === restaurant.restaurant.id);
			if (index === -1) return;

			// すでにアクティブなら詳細画面へ遷移
			if (activeRestaurantId === restaurant.restaurant.id) {
				// ストアに upsert
				const { upsert } = useRestaurantStore.getState();
				upsert({
					restaurant: restaurant.restaurant,
					meta: restaurant.meta,
				});

				router.push({
					pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]",
					params: { locale, restaurantId: restaurant.restaurant.id },
				});
				return;
			}

			// アクティブ更新（スクロールはシート側で active ID を監視して同期）
			setActiveRestaurantId(restaurant.restaurant.id);
		},
		[activeRestaurantId, lightImpact, savedRestaurants, locale],
	);

	// #644 【設計】保存したお店のカード押下時の処理（ボタン以外）（ストア upsert → 遷移）
	const handleSavedRestaurantCardPress = useCallback(
		(restaurant: SavedRestaurant) => {
			lightImpact();
			setActiveRestaurantId(restaurant.restaurant.id);

			// ストアに upsert
			const { upsert } = useRestaurantStore.getState();
			upsert({
				restaurant: restaurant.restaurant,
				meta: restaurant.meta,
			});

			router.push({
				pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]",
				params: { locale, restaurantId: restaurant.restaurant.id },
			});

			logFrontendEvent({
				event_name: "saved_restaurant_card_press",
				error_level: "log",
				payload: { restaurant_id: restaurant.restaurant.id },
			});
		},
		[lightImpact, logFrontendEvent, locale],
	);

	// #644 【設計】保存したお店カードの「写真・動画を投稿」ボタン押下時の処理（ストア upsert → レビュー画面遷移）
	const handleSavedRestaurantReviewPress = useCallback(
		(restaurant: SavedRestaurant) => {
			lightImpact();

			// ストアに upsert
			const { upsert } = useRestaurantStore.getState();
			upsert({
				restaurant: restaurant.restaurant,
				meta: restaurant.meta,
			});

			// レビュー投稿画面へ直接遷移
			router.push({
				pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]/review",
				params: { locale, restaurantId: restaurant.restaurant.id },
			});

			logFrontendEvent({
				event_name: "saved_restaurant_review_button_press",
				error_level: "log",
				payload: { restaurant_id: restaurant.restaurant.id },
			});
		},
		[lightImpact, logFrontendEvent, locale],
	);

	// 初回マウント時に現在地取得＆保存したお店検索
	useEffect(() => {
		// #644 【設計】レビューのレストラン選択画面表示ログ
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
			searchSavedRestaurants(newRegion);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<MarkerBitmapRendererProvider>
			<View style={styles.container}>
				{/* Map */}
				<MapView
					ref={mapRef}
					style={styles.map}
					onRegionChangeComplete={handleRegionChangeComplete}
					onPoiClick={handlePoiPress}>
					{/* #644 【設計】保存したお店のマーカー表示 */}
					{savedRestaurants.map((item: SavedRestaurant) => (
						<AvatarBubbleMarkerBitmap
							key={item.restaurant.id}
							coordinate={{
								latitude: item.restaurant.latitude,
								longitude: item.restaurant.longitude,
							}}
							onPress={() => handleSavedRestaurantMarkerPress(item)}
							color={activeRestaurantId === item.restaurant.id ? "#5EA2FF" : "#FFF"}
							uri={item.restaurant.imageUrls?.sm}
						/>
					))}
				</MapView>

				{/* POI Loading Indicator */}
				{isLoadingRestaurantCreation && (
					<View style={styles.loadingOverlay}>
						<ActivityIndicator size="large" color="#5EA2FF" />
					</View>
				)}

				{/* 🔹上部 UI レイヤー（ヘッダー＋検索＋ボタン） */}
				<View
					style={[styles.topOverlay]}
					pointerEvents="box-none" // 余白部分は Map をタッチ可能にする
				>
					{/* #644 【設計】画面タイトル with 戻るボタン */}
					<ReviewHeader
						title={i18n.t("Review.selectRestaurant.title")}
						onPressBack={() => {
							lightImpact();
							router.back();
						}}
					/>

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

					{/* Search This Area button under LocationAutocomplete; map remains interactive on sides */}
					<View style={styles.searchButtonContainer}>
						<PrimaryButton
							onPress={() => searchSavedRestaurants(currentRegion.current)}
							label={i18n.t("Review.selectRestaurant.searchThisArea")}
							icon={<RotateCw size={16} color="#357AFF" />}
							colors={["#ffffff", "#ffffff"]}
							shadowColor={"#000000"}
							labelStyle={{ color: "#357AFF", fontSize: 14 }}
							loading={isLoadingSavedRestaurants}
						/>
					</View>
				</View>

				{/* Saved Restaurants BottomSheet */}
				<SavedRestaurantsSheet
					ref={savedRestaurantsSheetRef}
					savedRestaurants={savedRestaurants}
					isLoadingSavedRestaurants={isLoadingSavedRestaurants}
					activeRestaurantId={activeRestaurantId}
					onRestaurantCardPress={handleSavedRestaurantCardPress}
					onRestaurantReviewPress={handleSavedRestaurantReviewPress}
					onSnapToRestaurant={(restaurant) => setActiveRestaurantId(restaurant.restaurant.id)}
				/>
			</View>
		</MarkerBitmapRendererProvider>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	map: {
		flex: 1,
	},
	topOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		zIndex: 100,
	},
	searchContainer: {
		marginTop: 8,
		marginHorizontal: 16,
	},
	currentLocationButton: {
		padding: 16,
		borderLeftWidth: 0.5,
		borderLeftColor: "#E5E7EB",
	},
	searchButtonContainer: {
		marginTop: 8,
		alignItems: "center",
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
