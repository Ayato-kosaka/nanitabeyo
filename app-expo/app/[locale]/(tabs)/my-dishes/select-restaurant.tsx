import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { View, StyleSheet, TouchableOpacity, InteractionManager } from "react-native";
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
	type QueryRestaurantsResponse,
	ErrorCode,
} from "@shared/api/v1/res";
import type { CreateRestaurantDto, QuerySavedRestaurantsDto } from "@shared/api/v1/dto";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import { useLogger } from "@/hooks/useLogger";
import MapViewClass from "react-native-maps";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { AvatarBubbleMarker } from "@/features/mapMarkers";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import {
	SavedRestaurantsSheet,
	SavedRestaurantsSheetHandle,
} from "@/features/restaurantPicker/components/SavedRestaurantsSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useRestaurantStore } from "@/stores/useRestaurantStore";
import { useLocale } from "@/hooks/useLocale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { INITIAL_REGION, REGION_JP } from "@/features/map/constants";
import { usePickedRestaurantStore } from "@/features/restaurantPicker/stores/usePickedRestaurantStore";

type SavedRestaurant = QueryMeSavedRestaurantsResponse["data"][number];

/**
 * レビュー投稿画面のレストラン選択マップ画面
 * - 地図上のPOIタップ or 検索バーからレストラン選択でレストラン作成＆詳細画面へ遷移
 * - 保存したお店を地図上にマーカー表示、カード表示
 */
export default function SelectRestaurantScreen() {
	/**
	 * #1375（3 巡目）`?mode=pick` — «お店を 1 件選んで戻る» モード。
	 *
	 * 食べたを記録（sns-import の統合フォーム）と SNS 取り込みの「地図からお店を選ぶ」が使う。
	 * このモードでは店舗詳細やレビュー画面へ **push しない**（ネイティブスタックが
	 * どんどん積まれる、と実機で指摘された）。選んだ結果を `usePickedRestaurantStore` に
	 * 置いて `router.back()` するだけである。既定（mode 無し）の挙動は従来どおり
	 */
	const { mode } = useLocalSearchParams<{ mode?: string }>();
	const isPickMode = mode === "pick";
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { locale, isJapanese } = useLocale();
	const navigation = useNavigation();
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

				if (isPickMode) {
					// pick モード: 選択として返して戻るだけ。詳細画面へは行かない
					usePickedRestaurantStore.getState().setPicked({
						restaurantId: response.restaurant.id,
						name: response.restaurant.name,
						restaurant: response.restaurant,
					});
					router.back();
					return;
				}

				// #644 【設計】ストアに upsert してから詳細画面へ遷移
				const { upsert } = useRestaurantStore.getState();
				upsert({
					restaurant: response.restaurant,
					meta: response.meta,
				});

				router.push({
					pathname: "/[locale]/restaurant/[restaurantId]",
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
		[callBackend, isPickMode, logFrontendEvent, showSnackbar, locale],
	);

	// #644 【設計】POI押下時にレストラン情報を取得してモーダル表示
	const handlePoiPress = useCallback(
		async (event: PoiClickEvent) => {
			lightImpact();
			createAndOpenRestaurant(event.nativeEvent.placeId);
		},
		[createAndOpenRestaurant, lightImpact],
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

	// 画面フォーカスに連動して Sheet を開閉
	const [isSheetVisible, setIsSheetVisible] = useState(false);
	// 画面フォーカス状態を保持する ref
	const isFocusedRef = useRef(false);
	useFocusEffect(
		useCallback(() => {
			isFocusedRef.current = true;
			// #1375 実機確認（2 巡目）: 遷移アニメーションの最中に TrueSheet を present すると、
			// iOS でシートが **遷移前の画面の view controller に取り付く**ことがあり、
			// 「シートは見えているのにボタンが効かず、タップが背後の画面へ抜ける」状態になる
			// （実機で «モーダルのボタンが効かない» と指摘された症状）。
			// InteractionManager で遷移が終わってから present する
			const task = InteractionManager.runAfterInteractions(() => {
				if (isFocusedRef.current) setIsSheetVisible(true);
			});
			return () => {
				task.cancel();
				isFocusedRef.current = false;
				setIsSheetVisible(false);
			};
		}, []),
	);
	// #644 【設計】SavedRestaurantsSheet の ref
	const savedRestaurantsSheetRef = useRef<SavedRestaurantsSheetHandle>(null);
	useEffect(() => {
		const unsubscribe = navigation.addListener("beforeRemove", () => {
			// 戻り操作（ボタンでもスワイプでも）開始時に必ずシートを閉じる
			savedRestaurantsSheetRef.current?.dismiss();
			setIsSheetVisible(false);
		});

		return unsubscribe;
	}, [navigation]);

	// シート表示を安全に行う関数
	const safePresentSheet = useCallback(() => {
		if (!isFocusedRef.current) return;
		setIsSheetVisible(true);
	}, []);

	// #644 【設計】保存したお店の状態管理
	const [savedRestaurants, setSavedRestaurants] = useState<QueryMeSavedRestaurantsResponse["data"]>([]);
	const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);
	const [isLoadingSavedRestaurants, setIsLoadingSavedRestaurants] = useState(false);
	const isLoadingSavedRestaurantsRef = useRef(false);
	useEffect(() => {
		isLoadingSavedRestaurantsRef.current = isLoadingSavedRestaurants;
	}, [isLoadingSavedRestaurants]);

	// #644 【設計】保存したお店を現在地で検索
	const searchSavedRestaurants = useCallback(
		async (region: Region) => {
			if (isLoadingSavedRestaurantsRef.current) return;

			lightImpact();
			setIsLoadingSavedRestaurants(true);

			// 保存したお店の検索後に必ずシートを開く
			safePresentSheet();
			try {
				const response = await callBackend<QuerySavedRestaurantsDto, QueryMeSavedRestaurantsResponse>(
					"v1/users/me/saved-restaurants",
					{
						method: "GET",
						requestPayload: {
							lat: region.latitude,
							lng: region.longitude,
							radius: Math.max(region.latitudeDelta, region.longitudeDelta) * 50000,
							limit: 20,
						},
					},
				);

				setSavedRestaurants(response.data);
				setActiveRestaurantId(null);
			} catch (error) {
				showSnackbar(i18n.t("SelectRestaurant.fetchSavedRestaurantsError"));
				logFrontendEvent({
					event_name: "saved_restaurants_search_error",
					error_level: "error",
					payload: { error },
				});
			} finally {
				setIsLoadingSavedRestaurants(false);
			}
		},
		[callBackend, lightImpact, logFrontendEvent, showSnackbar, safePresentSheet],
	);

	// #644 【設計】保存したお店のマーカー押下時の処理（ストア upsert → 遷移）
	const handleSavedRestaurantMarkerPress = useCallback(
		(restaurant: SavedRestaurant) => {
			lightImpact();

			const index = savedRestaurants.findIndex((r) => r.restaurant.id === restaurant.restaurant.id);
			if (index === -1) return;

			// すでにアクティブなら確定（pick モードは選択して戻る / 通常は詳細画面へ）
			if (activeRestaurantId === restaurant.restaurant.id) {
				if (isPickMode) {
					usePickedRestaurantStore.getState().setPicked({
						restaurantId: restaurant.restaurant.id,
						name: restaurant.restaurant.name,
						restaurant: restaurant.restaurant,
					});
					router.back();
					return;
				}
				// ストアに upsert
				const { upsert } = useRestaurantStore.getState();
				upsert({
					restaurant: restaurant.restaurant,
					meta: restaurant.meta,
				});

				router.push({
					pathname: "/[locale]/restaurant/[restaurantId]",
					params: { locale, restaurantId: restaurant.restaurant.id },
				});
				return;
			}

			// アクティブ更新（スクロールはシート側で active ID を監視して同期）
			setActiveRestaurantId(restaurant.restaurant.id);
		},
		[activeRestaurantId, isPickMode, lightImpact, savedRestaurants, locale],
	);

	// #644 【設計】保存したお店のカード押下時の処理（ボタン以外）（ストア upsert → 遷移）
	const handleSavedRestaurantCardPress = useCallback(
		(restaurant: SavedRestaurant) => {
			lightImpact();
			setActiveRestaurantId(restaurant.restaurant.id);

			if (isPickMode) {
				usePickedRestaurantStore.getState().setPicked({
					restaurantId: restaurant.restaurant.id,
					name: restaurant.restaurant.name,
					restaurant: restaurant.restaurant,
				});
				router.back();
				return;
			}

			// ストアに upsert
			const { upsert } = useRestaurantStore.getState();
			upsert({
				restaurant: restaurant.restaurant,
				meta: restaurant.meta,
			});

			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: restaurant.restaurant.id },
			});

			logFrontendEvent({
				event_name: "saved_restaurant_card_press",
				error_level: "log",
				payload: { restaurant_id: restaurant.restaurant.id },
			});
		},
		[isPickMode, lightImpact, logFrontendEvent, locale],
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
				pathname: "/[locale]/restaurant/[restaurantId]/review",
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

	// Map ready 後に pendingRegionRef に保存された region があれば移動させる
	const [mapReady, setMapReady] = useState(false);
	const pendingRegionRef = useRef<Region | null>(null);
	useEffect(() => {
		if (!mapReady) return;

		const region = pendingRegionRef.current;
		if (!region) return;

		mapRef.current?.animateToRegion(region, 1); // 1msで“delta含め確定”させる
		pendingRegionRef.current = null;
	}, [mapReady]);

	const initialRegion = useMemo<Region>(() => (isJapanese ? REGION_JP : INITIAL_REGION), [isJapanese]);
	const didInitRef = useRef(false);
	// 初期表示時の現在地取得＆保存店検索
	useEffect(() => {
		if (didInitRef.current) return;
		didInitRef.current = true;

		let cancelled = false;

		const init = async () => {
			logFrontendEvent({
				event_name: "screen_view",
				error_level: "log",
				payload: { screen: "review_select_restaurant" },
			});

			try {
				if (isJapanese) {
					pendingRegionRef.current = REGION_JP;
					currentRegion.current = REGION_JP;
					mapRef.current?.animateToRegion(REGION_JP, 1000);
					await searchSavedRestaurants(REGION_JP);
					return;
				}

				const { location } = await getCurrentLocation();
				if (cancelled) return;

				const newRegion = {
					latitude: location.latitude,
					longitude: location.longitude,
					latitudeDelta: 0.01,
					longitudeDelta: 0.01,
				};

				pendingRegionRef.current = newRegion;
				currentRegion.current = newRegion;
				mapRef.current?.animateToRegion(newRegion, 1000);
				await searchSavedRestaurants(newRegion);
			} catch (error) {
				if (cancelled) return;
				pendingRegionRef.current = REGION_JP;
				currentRegion.current = REGION_JP;
				mapRef.current?.animateToRegion(REGION_JP, 1000);
				await searchSavedRestaurants(REGION_JP);
			}
		};

		init();
		return () => {
			cancelled = true;
		};
	}, [getCurrentLocation, isJapanese, logFrontendEvent, searchSavedRestaurants]);

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
					// エリア選択時にそのエリアで保存したお店を検索
					searchSavedRestaurants(newRegion);
				} catch (error) {
					logFrontendEvent({
						event_name: "MapSearchError",
						error_level: "error",
						payload: { error, prediction },
					});
				}
			}
		},
		[createAndOpenRestaurant, getLocationDetails, lightImpact, logFrontendEvent, searchSavedRestaurants],
	);

	return (
		<View style={styles.container}>
			{/* Map */}
			<MapView
				ref={mapRef}
				style={styles.map}
				initialRegion={initialRegion}
				onMapReady={() => setMapReady(true)}
				onRegionChangeComplete={handleRegionChangeComplete}
				onPoiClick={handlePoiPress}>
				{/* #644 【設計】保存したお店のマーカー表示 */}
				{savedRestaurants.map((item: SavedRestaurant) => (
					<AvatarBubbleMarker
						key={item.restaurant.id}
						coordinate={{
							latitude: item.restaurant.latitude,
							longitude: item.restaurant.longitude,
						}}
						onPress={() => handleSavedRestaurantMarkerPress(item)}
						color={
							// 地図タイルは常にライト配色のため、非アクティブのバブルは固定白（FixedColors 参照）
							activeRestaurantId === item.restaurant.id ? colors.brand : FixedColors.mapMarkerSurface
						}
						isActive={activeRestaurantId === item.restaurant.id}
						uri={item.restaurant.imageUrls?.sm}
					/>
				))}
			</MapView>

			{/* Loading Indicator */}
			{isLoadingRestaurantCreation && (
				<View style={styles.loadingOverlay}>
					<LoadingIndicator size="large" />
				</View>
			)}

			{/* 🔹上部 UI レイヤー（ヘッダー＋検索＋ボタン） */}
			<View
				style={[styles.topOverlay]}
				pointerEvents="box-none" // 余白部分は Map をタッチ可能にする
			>
				{/* #644 【設計】画面タイトル with 戻るボタン */}
				<ScreenHeader
					title={i18n.t(isPickMode ? "SelectRestaurant.pickTitle" : "SelectRestaurant.title")}
					onPressBack={() => {
						lightImpact();
						router.back();
					}}
				/>

				{/* #1375 実機確認: 検索窓は 1 本だけにする。
				    以前は #1398 PR6 の店名検索（自前 restaurants テーブル）と、この
				    Places の検索の 2 本が縦に並んでいて、どちらに何を打てばよいか分からなかった。
				    店名検索の部品自体（`RestaurantNameSearch`）は消していない。

				    ⚠️ この 1 本は «エリア専用» ではない（2 巡目の指摘「保存してないお店が見れない」）。
				    `handleAutocompleteSelect` は候補が飲食店なら `createAndOpenRestaurant` へ、
				    そうでなければ地図移動 +（そのエリアの）保存済み検索へ振り分ける。つまり
				    **店名を打てば未保存の店もそのまま選べる**。プレースホルダを「エリアで検索」に
				    していたせいでその道が隠れていたので、「店名やエリアで検索」に戻す */}
				<View style={styles.searchContainer}>
					<LocationAutocomplete
						value={searchQuery}
						onChangeText={setSearchQuery}
						onSelectSuggestion={handleAutocompleteSelect}
						onClear={() => setSearchQuery("")}
						placeholder={i18n.t("Map.placeholders.searchRestaurantsForReview")}
						renderInputRight={
							<TouchableOpacity
								style={styles.currentLocationButton}
								onPress={handleCurrentLocation}
								hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
								accessibilityRole="button"
								accessibilityLabel={i18n.t("Map.accessibility.useCurrentLocation")}
								testID="review-select-restaurant-current-location-button">
								<Navigation size={20} color={colors.textStrong} />
							</TouchableOpacity>
						}
					/>
				</View>

				{/* Search This Area button under LocationAutocomplete; map remains interactive on sides */}
				<View style={styles.searchButtonContainer}>
					<PrimaryButton
						onPress={() => searchSavedRestaurants(currentRegion.current)}
						label={i18n.t("SelectRestaurant.searchThisArea")}
						icon={<RotateCw size={16} color={colors.link} />}
						colors={[colors.surface, colors.surface]}
						shadowColor={"transparent"}
						labelStyle={{ color: colors.link, fontSize: 14 }}
						loading={isLoadingSavedRestaurants}
						loadingIndicatorType="native"
						nativeLoadingColor={colors.link}
					/>
				</View>
			</View>

			{/* Saved Restaurants BottomSheet */}
			<SavedRestaurantsSheet
				ref={savedRestaurantsSheetRef}
				visible={isSheetVisible}
				showReviewButton={!isPickMode}
				savedRestaurants={savedRestaurants}
				isLoadingSavedRestaurants={isLoadingSavedRestaurants}
				activeRestaurantId={activeRestaurantId}
				onRestaurantCardPress={handleSavedRestaurantCardPress}
				onRestaurantReviewPress={handleSavedRestaurantReviewPress}
				onSnapToRestaurant={(restaurant) => setActiveRestaurantId(restaurant.restaurant.id)}
			/>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
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
			borderLeftColor: c.border,
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
