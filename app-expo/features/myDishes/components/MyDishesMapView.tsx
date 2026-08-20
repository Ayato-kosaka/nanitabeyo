import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RotateCw, X } from "lucide-react-native";
import { router } from "expo-router";
import MapViewClass from "react-native-maps";
import MapView, { type Region } from "@/components/MapView";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { AvatarBubbleMarker } from "@/features/mapMarkers";
import { INITIAL_REGION, REGION_JP } from "@/features/map/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { MyDishPin } from "@shared/api/v1/res";
import { boundingRegionForCoordinates, isRegionTooWide, regionToArea } from "../geo";
import { useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesMapPinsQuery } from "../hooks/useMyDishesMapPinsQuery";

/**
 * #1396 my-dishes の Map ビュー（設計書 (2/2) §7 の PR4）。
 *
 * ## ⚠️ viewport（`Region`）を filter store に絶対に入れない（設計書 (2/2) §3-2）
 *
 * pan / zoom は毎フレーム発火する。`onRegionChangeComplete` は下の `currentRegionRef`
 * （`useRef`）へ書くだけで、**`useMyDishesFilterStore` には一切触れない**。
 * store（= `queryKey`）を書くのは「このエリアで再検索」ボタン押下時の `commitArea` だけ。
 * これは既存 `select-restaurant.tsx` の `currentRegion` ref の先例をそのまま踏襲している。
 *
 * ピンは一覧ビューと**同じ `queryKey`**（`useMyDishesMapPinsQuery` 内部）を使うので、
 * フィルタ変更は一覧・Map の両方に同時に効き、ビュー切替では取り直さない。
 */
export function MyDishesMapView() {
	const { locale, isJapanese } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const area = useMyDishesFilterStore((s) => s.filter.area);
	const commitArea = useMyDishesFilterStore((s) => s.commitArea);
	const clearArea = useMyDishesFilterStore((s) => s.clearArea);
	const { pins, isLoading, error, hasFetchedInitial, truncated, refresh } = useMyDishesMapPinsQuery();

	const initialRegion = useMemo<Region>(() => (isJapanese ? REGION_JP : INITIAL_REGION), [isJapanese]);

	const mapRef = useRef<MapViewClass>(null);
	// #1396 【設計】生の viewport はここにだけ置く。store には絶対に書かない（§3-2）
	const currentRegionRef = useRef<Region>(initialRegion);
	// #1396 M-2: ボタンのラベル（「このエリアで再検索」）と実際に確定する範囲が大きくずれる
	// （regionToArea が MAX_AREA_RADIUS_M で clamp する）ズームレベルではボタンを無効化する。
	// store には触れないローカル state なので §3-2 の不変条件は破らない。
	const [isTooWide, setIsTooWide] = useState(() => isRegionTooWide(initialRegion));

	const handleRegionChangeComplete = useCallback((region: Region) => {
		currentRegionRef.current = region;
		setIsTooWide(isRegionTooWide(region));
	}, []);

	// #1396 【設計】store（= queryKey）を書く唯一の口。ボタン押下時にのみ呼ばれる
	const handleSearchThisArea = useCallback(() => {
		lightImpact();
		const nextArea = regionToArea(currentRegionRef.current);
		if (!nextArea) return;
		commitArea(nextArea);
		logFrontendEvent({
			event_name: "my_dishes_map_search_this_area",
			error_level: "log",
			payload: { lat: nextArea.lat, lng: nextArea.lng, radius: nextArea.radius },
		});
	}, [commitArea, lightImpact, logFrontendEvent]);

	// #1396 M-2: Map からエリア絞り込みを解除する唯一の口（filters 画面を開かなくても戻れるようにする）
	const handleClearArea = useCallback(() => {
		lightImpact();
		clearArea();
		logFrontendEvent({ event_name: "my_dishes_map_area_cleared", error_level: "log", payload: {} });
	}, [clearArea, lightImpact, logFrontendEvent]);

	// #1396 M-3: web は `initialRegion`（uncontrolled）を読まないため、`onMapReady` 後に
	// `animateToRegion` で明示的に補正する（先例: select-restaurant.tsx の `pendingRegionRef`）。
	const [mapReady, setMapReady] = useState(false);
	const pendingRegionRef = useRef<Region | null>(initialRegion);
	const handleMapReady = useCallback(() => setMapReady(true), []);
	useEffect(() => {
		if (!mapReady) return;
		const region = pendingRegionRef.current;
		if (!region) return;
		mapRef.current?.animateToRegion(region, 1);
		pendingRegionRef.current = null;
	}, [mapReady]);

	// #1396 m-1: エリア未確定だと全世界のピンが返るため、初回取得後に一度だけピンの外接矩形へ寄せる。
	// ⚠️ store は書かない・再取得も起こさない・二度目以降の取得では発火しない（ref で一度きりに固定する）
	const hasFitPinsRef = useRef(false);
	useEffect(() => {
		if (hasFitPinsRef.current) return;
		if (!hasFetchedInitial) return;
		hasFitPinsRef.current = true;
		const region = boundingRegionForCoordinates(
			pins.map((pin) => ({ latitude: pin.restaurant.latitude, longitude: pin.restaurant.longitude })),
		);
		if (!region) return;
		mapRef.current?.animateToRegion(region, 1000);
	}, [hasFetchedInitial, pins]);

	const handlePinPress = useCallback(
		(pin: MyDishPin) => {
			lightImpact();
			logFrontendEvent({
				event_name: "my_dishes_map_pin_selected",
				error_level: "log",
				payload: { restaurantId: pin.restaurant.id },
			});
			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: pin.restaurant.id },
			});
		},
		[lightImpact, locale, logFrontendEvent],
	);

	const showInitialLoading = isLoading && !hasFetchedInitial && !error;
	// #1396 M-1: 取得失敗時（hasFetchedInitial === false のまま）でも EmptyState を出し、
	// 再試行の口（refresh）へ UI から到達できるようにする。一覧ビュー（GridList の
	// ListEmptyComponent）と同じく hasFetchedInitial の成否に関わらず error を優先する。
	const showEmpty = !isLoading && (error !== null || (hasFetchedInitial && pins.length === 0));
	// #1396 n-1: 初回失敗後の再取得（hasFetchedInitial === false）でもボタンのスピナーを出す
	const showButtonLoading = isLoading && (hasFetchedInitial || error !== null);

	return (
		<View style={styles.container} testID="my-dishes-map">
			<MapView
				ref={mapRef}
				style={styles.map}
				initialRegion={initialRegion}
				onMapReady={handleMapReady}
				onRegionChangeComplete={handleRegionChangeComplete}>
				{pins.map((pin) => (
					<AvatarBubbleMarker
						key={pin.restaurant.id}
						testID="my-dishes-map-pin"
						coordinate={{ latitude: pin.restaurant.latitude, longitude: pin.restaurant.longitude }}
						onPress={() => handlePinPress(pin)}
						uri={pin.representativeThumbnailUrl ?? pin.restaurant.image_url ?? undefined}
					/>
				))}
			</MapView>

			{showInitialLoading && (
				<View style={styles.loadingOverlay} pointerEvents="none">
					<LoadingIndicator size="large" />
				</View>
			)}

			<View style={styles.topOverlay} pointerEvents="box-none">
				<View style={styles.searchButtonContainer}>
					<PrimaryButton
						testID="my-dishes-search-this-area"
						onPress={handleSearchThisArea}
						label={i18n.t("MyDishes.searchThisArea")}
						icon={<RotateCw size={16} color="#357AFF" />}
						colors={["#ffffff", "#ffffff"]}
						shadowColor="transparent"
						labelStyle={{ color: "#357AFF", fontSize: 14 }}
						loading={showButtonLoading}
						disabled={isTooWide}
						loadingIndicatorType="native"
						nativeLoadingColor="#357AFF"
					/>
					{/* #1396 M-2: 既定 viewport（REGION_JP）のまま押すと MAX_AREA_RADIUS_M へ
						clamp され、ボタンのラベルと確定する範囲が大きくずれるためズームを促す */}
					{isTooWide && (
						<Text style={styles.zoomHintText} testID="my-dishes-map-zoom-hint">
							{i18n.t("MyDishes.map.zoomInHint")}
						</Text>
					)}
				</View>
				{!!area && (
					<View style={styles.areaActiveBanner} testID="my-dishes-map-area-active">
						<Text style={styles.areaActiveText}>{i18n.t("MyDishes.map.areaActive")}</Text>
						<Pressable
							testID="my-dishes-map-area-clear"
							onPress={handleClearArea}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("MyDishes.filters.area.clear")}
							hitSlop={8}>
							<X size={14} color="#FFFFFF" />
						</Pressable>
					</View>
				)}
				{truncated && (
					<View style={styles.truncatedBanner} testID="my-dishes-map-truncated">
						<Text style={styles.truncatedText}>{i18n.t("MyDishes.map.truncated")}</Text>
					</View>
				)}
			</View>

			{showEmpty && (
				<View
					style={styles.emptyOverlay}
					pointerEvents={error ? "auto" : "none"}
					testID="my-dishes-map-empty-overlay">
					<EmptyState
						message={i18n.t("MyDishes.empty.description")}
						error={error}
						onRetry={refresh}
						testID="my-dishes-map-empty"
					/>
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	map: {
		flex: 1,
	},
	loadingOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "rgba(255, 255, 255, 0.5)",
	},
	topOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		zIndex: 100,
	},
	searchButtonContainer: {
		marginTop: 12,
		alignItems: "center",
	},
	zoomHintText: {
		marginTop: 6,
		fontSize: 12,
		color: "#111827",
		textAlign: "center",
		textShadowColor: "rgba(255,255,255,0.9)",
		textShadowRadius: 4,
	},
	areaActiveBanner: {
		marginTop: 8,
		marginHorizontal: 24,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 8,
		backgroundColor: "rgba(53, 122, 255, 0.9)",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
	},
	areaActiveText: {
		fontSize: 12,
		color: "#FFFFFF",
		textAlign: "center",
	},
	truncatedBanner: {
		marginTop: 8,
		marginHorizontal: 24,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 8,
		backgroundColor: "rgba(17, 24, 39, 0.85)",
	},
	truncatedText: {
		fontSize: 12,
		color: "#FFFFFF",
		textAlign: "center",
	},
	emptyOverlay: {
		position: "absolute",
		top: 80,
		left: 24,
		right: 24,
		bottom: 24,
	},
});
