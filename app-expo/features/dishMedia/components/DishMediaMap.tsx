import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { StyleSheet, View, Dimensions, Text } from "react-native";
import Carousel from "react-native-reanimated-carousel";
import MapView, { Region } from "@/components/MapView";
import DishMediaContent from "./DishMediaContent";
import { AvatarBubbleMarkerBitmap, MarkerBitmapRendererProvider } from "@/features/mapMarkers";
import { useHaptics } from "@/hooks/useHaptics";
import * as Crypto from "expo-crypto";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
	DishMediaEntriesStore,
	IdType,
	NormalizedDishMediaEntry,
	selectEntryByMediaId,
	selectEntryByReviewId,
	selectIdsByKey,
	useDishMediaEntriesStore,
} from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { ActivityIndicator } from "react-native";
import i18n from "@/lib/i18n";
import { useActionSheet } from "@expo/react-native-action-sheet";
import { useDishMediaActions } from "../hooks/useDishMediaActions";

const { width, height } = Dimensions.get("window");

// #605 【設計】Carousel の展開/縮小比率（画面高さに対する割合）
const EXPANDED_RATIO = 0.8;
const COLLAPSED_RATIO = 0.4;
const CAROUSEL_HEIGHT = height * EXPANDED_RATIO;
// parallaxScrollingScale
const PARALLAX_SCALE = 0.85;
// #605 【設計】ハンドル高さ（ドラッグ可能領域）
const HANDLE_HEIGHT = 44;
// #605 【設計】スナップ判定の閾値（0.5 = 中間点）
const SNAP_THRESHOLD = 0.5;
// #605 【設計】ハンドルの色（半透明白）
const HANDLE_COLOR = "#FFFFFFFF";

interface DishMediaMapProps {
	initialIndex?: number;
	onIndexChange?: (index: number) => void;
	initialLocation?: {
		latitude: number;
		longitude: number;
	};
	getTitle?: (item: NormalizedDishMediaEntry) => string | null;
	// 呼び出し元コンテキスト（画面用途キー）
	entriesKey: string;
	// ID の種類（dish_media / dish_reviews）
	idType: IdType;
}

export default function DishMediaMap({
	initialIndex = 0,
	onIndexChange,
	initialLocation,
	getTitle,
	entriesKey,
	idType,
}: DishMediaMapProps) {
	const selector = useCallback(
		(state: DishMediaEntriesStore) => selectIdsByKey(entriesKey, idType)(state),
		[entriesKey, idType],
	);
	const { ids: liveIds, isLoading, error } = useDishMediaEntriesStore(selector, shallow);

	// 画面を開いた時点の並びを固定するための state
	// liked/unlike 等のリアルタイム反映は行わない
	const [ids, setIds] = useState<string[]>([]);
	useEffect(() => {
		if (ids.length === 0 && liveIds.length > 0) setIds(liveIds);
	}, [liveIds, ids.length]);
	const restaurants = useMemo(() => {
		if (ids.length === 0) return [];
		const state = useDishMediaEntriesStore.getState(); // ← subscribe しない snapshot 読み
		return ids
			.map((id) =>
				idType === "dish_media"
					? selectEntryByMediaId(id)(state)?.restaurant
					: selectEntryByReviewId(id)(state)?.restaurant,
			)
			.filter((restaurant): restaurant is NonNullable<typeof restaurant> => restaurant !== undefined)
			.map((restaurant) => ({
				id: restaurant.id,
				name: restaurant.name,
				coordinate: { latitude: restaurant.latitude, longitude: restaurant.longitude },
				imageUrls: restaurant.imageUrls,
				google_place_id: restaurant.google_place_id,
			}));
	}, [ids, idType]);

	const [currentIndex, setCurrentIndex] = useState(initialIndex);
	const carouselRef = useRef<any>(null);
	const mapRef = useRef<any>(null);
	const { selectionChanged } = useHaptics();

	// 一意なセッションID（DishMediaContent へ伝搬）
	const sessionId = useRef(Crypto.randomUUID());

	// #605 【設計】Carousel の上下移動量（0 = Expanded, MAX_TRANSLATE_Y = Collapsed）
	const MAX_TRANSLATE_Y = height * (EXPANDED_RATIO - COLLAPSED_RATIO);
	const translateY = useSharedValue(MAX_TRANSLATE_Y);
	const gestureStartY = useSharedValue(0);

	// #605 【設計】 初期表示時に展開状態にアニメーション
	useEffect(() => {
		// #605 TODO: withTiming に変更検討
		translateY.value = withSpring(0, {
			duration: 3000,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// #605 【設計】ドラッグジェスチャーハンドラー（ハンドル領域でのみ有効）
	const panGesture = Gesture.Pan()
		.onStart(() => {
			gestureStartY.value = translateY.value;
		})
		.onUpdate((event) => {
			const newY = gestureStartY.value + event.translationY;
			// 0 〜 MAX_TRANSLATE_Y の範囲に制限
			translateY.value = Math.max(0, Math.min(newY, MAX_TRANSLATE_Y));
		})
		.onEnd((event) => {
			// #605 【設計】スナップ判定（中間点 or 速度ベース）
			const velocity = event.velocityY;
			const shouldCollapse =
				velocity > 500 || (Math.abs(velocity) < 500 && translateY.value > MAX_TRANSLATE_Y * SNAP_THRESHOLD);

			translateY.value = withSpring(shouldCollapse ? MAX_TRANSLATE_Y : 0, {
				damping: 20,
				stiffness: 200,
			});
		});

	// #605 【設計】Carousel コンテナのアニメーションスタイル
	const animatedCarouselStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: translateY.value }],
	}));

	const getMapRegion = useCallback((): Region => {
		if (restaurants.length === 0) {
			return {
				latitude: initialLocation?.latitude ?? 35.6762,
				longitude: initialLocation?.longitude ?? 139.6503,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
		}

		// マップのアスペクト比
		const aspectRatio = width / height;

		// 全ピンの最小・最大座標を取得
		const latitudes = restaurants.map((restaurant) => restaurant.coordinate.latitude);
		const longitudes = restaurants.map((restaurant) => restaurant.coordinate.longitude);

		const minLat = Math.min(...latitudes);
		const maxLat = Math.max(...latitudes);
		const minLng = Math.min(...longitudes);
		const maxLng = Math.max(...longitudes);

		// ピン群の中心
		const centerLat = (minLat + maxLat) / 2;
		const centerLng = (minLng + maxLng) / 2;

		// Δ計算（安全マージン込み）
		let latDelta = Math.max((maxLat - minLat) * 1.5, 0.01) * 1.2; // 20% 余裕
		let lngDelta = Math.max((maxLng - minLng) * 1.5, 0.01) * 1.2;

		// 上1/5にピン群を表示するためのオフセット計算
		// 通常は centerLat が画面中央になる → ピン群の下に 4/5 スペースが欲しい
		const verticalSpaceRatio = 0.5; // 下に 30% の余白を持たせる
		const verticalOffset = latDelta * verticalSpaceRatio;
		return {
			latitude: centerLat - verticalOffset,
			longitude: centerLng,
			latitudeDelta: latDelta,
			longitudeDelta: lngDelta,
		};
	}, [restaurants, initialLocation]);

	useEffect(() => {
		// 初期位置設定
		if (mapRef.current && restaurants.length > 0) {
			mapRef.current.animateToRegion(getMapRegion(), 1000);
		}
	}, [getMapRegion, restaurants]);

	const handleIndexChange = useCallback(
		(index: number) => {
			selectionChanged();
			setCurrentIndex(index);
			onIndexChange?.(index);
		},
		[onIndexChange, selectionChanged],
	);

	const handleMarkerPress = useCallback((index: number) => {
		carouselRef.current?.scrollTo({ index, animated: true });
	}, []);

	// #613 【設計】カード押下時に ActionSheet を開く処理（DishMediaContent から entry を受け取る）
	const { showActionSheetWithOptions } = useActionSheet();
	const { openInGoogleMaps, shareRestaurant } = useDishMediaActions({
		source: "DishMediaMap",
	});
	const handleCardPress = useCallback(
		async (entry: NormalizedDishMediaEntry) => {
			const dishMediaId = entry.dish_media.id;
			const restaurant = entry.restaurant;

			const options = [
				i18n.t("ActionSheet.openInGoogleMaps"),
				i18n.t("ActionSheet.shareWithFriends"),
				i18n.t("ActionSheet.cancel"),
			];
			const cancelButtonIndex = 2;

			showActionSheetWithOptions(
				{
					title: i18n.t("ActionSheet.title"),
					options,
					cancelButtonIndex,
				},
				async (selectedIndex?: number) => {
					if (selectedIndex === undefined || selectedIndex === cancelButtonIndex) return;

					switch (selectedIndex) {
						case 0: {
							// #613 【設計】Google マップで開く
							await openInGoogleMaps({
								dishMediaId,
								restaurant,
							});
							break;
						}
						case 1: {
							// #613 【設計】友人に共有する
							await shareRestaurant({
								dishMediaId,
								restaurant,
							});
							break;
						}
					}
				},
			);
		},
		[showActionSheetWithOptions, openInGoogleMaps, shareRestaurant],
	);

	const renderCarouselItem = useCallback(
		({ item, index }: { item: string; index: number }) => (
			<View style={styles.carouselItem}>
				<DishMediaContent
					id={item}
					carouselRef={carouselRef}
					isActive={index === currentIndex}
					getTitle={getTitle}
					sessionId={sessionId.current}
					entriesKey={entriesKey}
					idType={idType}
					onCardPress={handleCardPress} // #613 【設計】カード押下時のコールバックを渡す
				/>
			</View>
		),
		[currentIndex, getTitle, entriesKey, idType, handleCardPress],
	);

	return (
		<MarkerBitmapRendererProvider>
			<View style={styles.container}>
				{/* この位置に置かないとマップが起動しなくなる */}
				{isLoading && (
					<View style={styles.centerContainer}>
						<ActivityIndicator size="large" color="#5EA2FF" />
						<Text style={styles.loadingText}>{i18n.t("Profile.loading")}</Text>
					</View>
				)}

				{error && (
					<View style={styles.centerContainer}>
						<Text style={styles.errorText}>{error}</Text>
					</View>
				)}

				{/* Map View - Top 1/5 of screen */}
				<View style={styles.mapContainer}>
					<MapView ref={mapRef} style={styles.map} initialRegion={getMapRegion()}>
						{restaurants.map((restaurant, index) => (
							<AvatarBubbleMarkerBitmap
								key={`marker-${restaurant.google_place_id}`}
								coordinate={restaurant.coordinate}
								onPress={() => handleMarkerPress(index)}
								uri={restaurant.imageUrls?.sm}
								color={index === currentIndex ? "rgb(52, 119, 248)" : "#FFF"}
							/>
						))}
					</MapView>
				</View>

				{/* #605 【設計】Carousel を Animated.View で包み、translateY で上下移動 */}
				<Animated.View style={[styles.carouselWrapper, animatedCarouselStyle]}>
					{/* #605 【設計】ドラッグハンドル（上端バー周辺のみドラッグ可能） */}
					<GestureDetector gesture={panGesture}>
						<View style={styles.handleContainer}>
							<View style={styles.handle} />
						</View>
					</GestureDetector>

					{/* Carousel - Bottom 4/5 of screen, overlapping map */}
					<Carousel
						ref={carouselRef}
						width={width}
						height={CAROUSEL_HEIGHT}
						data={ids}
						renderItem={renderCarouselItem}
						onSnapToItem={handleIndexChange}
						defaultIndex={initialIndex}
						mode="parallax"
						modeConfig={{
							parallaxScrollingScale: PARALLAX_SCALE,
							parallaxScrollingOffset: 75,
						}}
						style={styles.carousel}
						containerStyle={styles.carouselContainer}
					/>
				</Animated.View>
			</View>
		</MarkerBitmapRendererProvider>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
	mapContainer: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		zIndex: 1,
	},
	map: {
		flex: 1,
	},
	// #605 【設計】Carousel 全体を包むラッパー（translateY でアニメーション）
	carouselWrapper: {
		position: "absolute",
		height: CAROUSEL_HEIGHT,
		left: 0,
		right: 0,
		bottom: -(CAROUSEL_HEIGHT * (1 - PARALLAX_SCALE)) / 2,
		zIndex: 2,
	},
	// #605 【設計】ドラッグハンドルコンテナ（タップ可能領域）
	handleContainer: {
		position: "absolute",
		top: (CAROUSEL_HEIGHT * (1 - PARALLAX_SCALE)) / 2,
		height: HANDLE_HEIGHT,
		width: "100%",
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "transparent",
		zIndex: 3,
	},
	// #605 【設計】ハンドル（短い横棒）
	handle: {
		width: 40,
		height: 5,
		borderRadius: 2.5,
		backgroundColor: HANDLE_COLOR,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.55,
		shadowRadius: 3,
		elevation: 4,
	},
	carouselContainer: {
		height: CAROUSEL_HEIGHT,
		left: 0,
		right: 0,
	},
	carousel: {
		flex: 1,
	},
	carouselItem: {
		flex: 1,
		borderRadius: 24,
		overflow: "hidden",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 32,
		elevation: 12,
	},
	centerContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "#000",
	},
	loadingText: {
		marginTop: 16,
		color: "#FFF",
		fontSize: 16,
	},
	errorText: {
		color: "#FF6B6B",
		fontSize: 16,
		textAlign: "center",
		paddingHorizontal: 20,
	},
});
