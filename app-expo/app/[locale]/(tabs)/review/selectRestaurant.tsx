import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Text, FlatList, Dimensions } from "react-native";
import { Navigation, RotateCw, ChevronLeft } from "lucide-react-native";
import MapView, { Region } from "@/components/MapView";
import type { PoiClickEvent } from "react-native-maps";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import {
	type AutocompleteLocation,
	type QueryRestaurantsResponse,
	type CreateRestaurantResponse,
	type QueryMeSavedRestaurantsResponse,
	ErrorCode,
} from "@shared/api/v1/res";
import type { CreateRestaurantDto, QuerySavedRestaurantsDto } from "@shared/api/v1/dto";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { SelectedRestaurantDetails } from "@/features/review/components/SelectedRestaurantDetails";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import MapViewClass from "react-native-maps";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { SafeAreaView } from "react-native-safe-area-context";
import { AvatarBubbleMarkerBitmap, MarkerBitmapRendererProvider } from "@/features/mapMarkers";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Image } from "expo-image";
import { getCacheKeyForImage } from "@/lib/image";
import { router } from "expo-router";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { useAuth } from "@/contexts/AuthProvider";
import { LoginbackModal } from "@/features/profile/components/LoginbackModal";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH * 0.9;

export default function SelectRestaurantScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { user } = useAuth();
	const [selectedPlace, setSelectedPlace] = useState<QueryMeSavedRestaurantsResponse["data"][number] | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [isLoadingRestaurantCreation, setIsLoadingRestaurantCreation] = useState(false);

	// #644 【設計】保存したお店の状態管理
	const [savedRestaurants, setSavedRestaurants] = useState<QueryMeSavedRestaurantsResponse["data"]>([]);
	const [isLoadingSavedRestaurants, setIsLoadingSavedRestaurants] = useState(false);
	const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);
	const savedRestaurantsListRef = useRef<FlatList>(null);

	const {
		BlurModal: RestaurantBlurModal,
		open: openRestaurantModal,
		close: closeRestaurantModal,
	} = useBlurModal({ intensity: 100 });

	// #644 【設計】レビュー投稿用モーダル（メディア選択ありモード）
	const {
		BlurModal: ReviewBlurModal,
		open: openReviewModal,
		close: closeReviewModal,
	} = useBlurModal({ intensity: 100, zIndex: 1200 });

	const {
		BlurModal: LoginBlurModal,
		open: openLoginModal,
		close: closeLoginModal,
	} = useBlurModal({ intensity: 100, zIndex: 1400 });

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
				setSelectedPlace({
					...response,
					meta: {
						...response.meta,
						lastSavedAt: null,
					},
				});
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

	// #644 【設計】保存したお店のマーカー押下時の処理
	const handleSavedRestaurantMarkerPress = useCallback(
		(restaurant: QueryMeSavedRestaurantsResponse["data"][number]) => {
			lightImpact();

			// すでにアクティブな場合はモーダルを開く
			if (activeRestaurantId === restaurant.restaurant.id) {
				setSelectedPlace(restaurant);
				openRestaurantModal();
			} else {
				// 非アクティブの場合はアクティブにして、リストをスクロール
				setActiveRestaurantId(restaurant.restaurant.id);
				const index = savedRestaurants.findIndex(
					(r: QueryMeSavedRestaurantsResponse["data"][number]) => r.restaurant.id === restaurant.restaurant.id,
				);
				if (index !== -1) {
					savedRestaurantsListRef.current?.scrollToIndex({ index, animated: true });
				}
			}
		},
		[activeRestaurantId, lightImpact, openRestaurantModal, savedRestaurants],
	);

	// #644 【設計】保存したお店のカード押下時の処理（ボタン以外）
	const handleSavedRestaurantCardPress = useCallback(
		(restaurant: QueryMeSavedRestaurantsResponse["data"][number]) => {
			lightImpact();
			setActiveRestaurantId(restaurant.restaurant.id);
			setSelectedPlace(restaurant);
			openRestaurantModal();

			logFrontendEvent({
				event_name: "saved_restaurant_card_press",
				error_level: "log",
				payload: { restaurant_id: restaurant.restaurant.id },
			});
		},
		[lightImpact, openRestaurantModal, logFrontendEvent],
	);

	// #644 【設計】保存したお店カードの「写真・動画を投稿」ボタン押下時の処理
	// SelectedRestaurantDetails の handleReviewButtonPress と同じ挙動（メディア選択ありモード）
	const handleSavedRestaurantReviewPress = useCallback(
		(restaurant: QueryMeSavedRestaurantsResponse["data"][number]) => {
			lightImpact();
			setSelectedPlace(restaurant);

			// #477【設計】匿名ユーザーの場合は LoginbackModal を表示、非匿名ユーザーの場合は ReviewForm を表示
			if (user?.is_anonymous !== false) {
				openLoginModal();
			} else {
				// ReviewForm を開くと同時にメディア選択が行われる
				openReviewModal();
			}

			logFrontendEvent({
				event_name: "saved_restaurant_review_button_press",
				error_level: "log",
				payload: { restaurant_id: restaurant.restaurant.id },
			});
		},
		[lightImpact, openReviewModal, openLoginModal, user, logFrontendEvent],
	);

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
			<SafeAreaView edges={["top"]} style={styles.container}>
				{/* #644 【設計】画面タイトル with 戻るボタン */}
				<View style={styles.headerContainer}>
					<TouchableOpacity
						style={styles.backButton}
						onPress={() => {
							lightImpact();
							router.back();
						}}>
						<ChevronLeft size={24} color="#1A1A1A" />
					</TouchableOpacity>
					<Text style={styles.headerTitle}>{i18n.t("Review.selectRestaurant.title")}</Text>
					<View style={styles.headerRightSpacer} />
				</View>

				{/* Map */}
				<MapView
					ref={mapRef}
					style={styles.map}
					onRegionChangeComplete={handleRegionChangeComplete}
					onPoiClick={handlePoiPress}>
					{/* #644 【設計】保存したお店のマーカー表示 */}
					{savedRestaurants.map((item: QueryMeSavedRestaurantsResponse["data"][number]) => (
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

				{/* #644 【設計】保存したお店リスト領域 */}
				<View style={styles.savedRestaurantsContainer}>
					{/* 「このエリアで再検索」ボタン */}
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

					{/* 保存したお店リストのタイトルとカード */}
					<View style={styles.savedRestaurantsSection}>
						{savedRestaurants.length > 0 ? (
							<>
								<Text style={styles.savedRestaurantsTitle}>
									{i18n.t("Review.selectRestaurant.savedRestaurantList")}
								</Text>
								<FlatList
									ref={savedRestaurantsListRef}
									data={savedRestaurants}
									horizontal
									showsHorizontalScrollIndicator={false}
									keyExtractor={(item) => item.restaurant.id}
									contentContainerStyle={styles.savedRestaurantsListContent}
									snapToInterval={CARD_WIDTH + 12}
									snapToAlignment="start"
									decelerationRate="fast"
									pagingEnabled={false}
									renderItem={({ item }) => (
										<TouchableOpacity
											style={styles.savedRestaurantCard}
											onPress={() => handleSavedRestaurantCardPress(item)}
											activeOpacity={0.7}>
											<Image
												source={{
													uri: item.restaurant.imageUrls?.md,
													cacheKey: getCacheKeyForImage(item.restaurant.imageUrls?.md),
												}}
												style={styles.savedRestaurantImage}
											/>
											<View style={styles.savedRestaurantInfo}>
												<Text style={styles.savedRestaurantName} numberOfLines={2}>
													{item.restaurant.name}
												</Text>
												<PrimaryButton
													onPress={() => handleSavedRestaurantReviewPress(item)}
													label={i18n.t("Review.selectRestaurant.postPhotoVideo")}
													colors={["#5EA2FF", "#5EA2FF"]}
													labelStyle={{ color: "#FFF", fontSize: 12 }}
													style={{ alignSelf: "flex-end" }}
												/>
											</View>
										</TouchableOpacity>
									)}
								/>
							</>
						) : savedRestaurants.length === 0 && !isLoadingSavedRestaurants ? (
							<Text style={styles.emptyStateText}>{i18n.t("Review.selectRestaurant.noSavedRestaurantsInArea")}</Text>
						) : null}
					</View>
				</View>

				<RestaurantBlurModal>
					{selectedPlace && (
						<SelectedRestaurantDetails restaurant={selectedPlace.restaurant} meta={selectedPlace.meta} />
					)}
				</RestaurantBlurModal>

				{/* #644 【設計】Review Modal - メディア選択ありモード */}
				<ReviewBlurModal>
					{({ close }) => selectedPlace && <ReviewForm restaurant={selectedPlace.restaurant} onCancel={close} />}
				</ReviewBlurModal>

				{/* Login Modal */}
				<LoginBlurModal>{({ close }) => <LoginbackModal onClose={close} />}</LoginBlurModal>
			</SafeAreaView>
		</MarkerBitmapRendererProvider>
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
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	backButton: {
		padding: 4,
		marginRight: 8,
	},
	headerTitle: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		flex: 1,
	},
	headerRightSpacer: {
		width: 32,
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
	// #644 【設計】保存したお店リスト関連のスタイル
	savedRestaurantsContainer: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		zIndex: 10,
	},
	savedRestaurantsSection: {
		backgroundColor: "#FFFFFF",
		paddingTop: 12,
		paddingBottom: 20,
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: -2 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 5,
	},
	searchButtonContainer: {
		alignItems: "center",
		marginBottom: 12,
	},
	savedRestaurantsTitle: {
		fontSize: 14,
		fontWeight: "600",
		color: "#666",
		marginHorizontal: 16,
		marginBottom: 8,
	},
	savedRestaurantsListContent: {
		paddingHorizontal: 16,
	},
	savedRestaurantCard: {
		width: CARD_WIDTH,
		flexDirection: "row",
		backgroundColor: "#FFF",
		borderRadius: 12,
		margin: 8,
		marginRight: 12,
		overflow: "hidden",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.2,
		shadowRadius: 8,
		elevation: 5,
	},
	savedRestaurantImage: {
		width: 100,
		height: 100,
	},
	savedRestaurantInfo: {
		flex: 1,
		padding: 12,
		justifyContent: "space-between",
	},
	savedRestaurantName: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	emptyStateText: {
		fontSize: 14,
		color: "#666",
		textAlign: "center",
		marginHorizontal: 16,
		marginTop: 8,
		marginBottom: 16,
	},
});
