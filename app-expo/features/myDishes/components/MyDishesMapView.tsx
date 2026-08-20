import React, { useCallback, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RotateCw } from "lucide-react-native";
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
import { regionToArea } from "../geo";
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
	const commitArea = useMyDishesFilterStore((s) => s.commitArea);
	const { pins, isLoading, error, hasFetchedInitial, truncated, refresh } = useMyDishesMapPinsQuery();

	const mapRef = useRef<MapViewClass>(null);
	// #1396 【設計】生の viewport はここにだけ置く。store には絶対に書かない（§3-2）
	const currentRegionRef = useRef<Region>(isJapanese ? REGION_JP : INITIAL_REGION);

	const handleRegionChangeComplete = useCallback((region: Region) => {
		currentRegionRef.current = region;
	}, []);

	// #1396 【設計】store（= queryKey）を書く唯一の口。ボタン押下時にのみ呼ばれる
	const handleSearchThisArea = useCallback(() => {
		lightImpact();
		const area = regionToArea(currentRegionRef.current);
		if (!area) return;
		commitArea(area);
		logFrontendEvent({
			event_name: "my_dishes_map_search_this_area",
			error_level: "log",
			payload: { lat: area.lat, lng: area.lng, radius: area.radius },
		});
	}, [commitArea, lightImpact, logFrontendEvent]);

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

	const initialRegion = useMemo<Region>(() => (isJapanese ? REGION_JP : INITIAL_REGION), [isJapanese]);

	const showInitialLoading = isLoading && !hasFetchedInitial;
	const showEmpty = hasFetchedInitial && !isLoading && pins.length === 0;

	return (
		<View style={styles.container} testID="my-dishes-map">
			<MapView
				ref={mapRef}
				style={styles.map}
				initialRegion={initialRegion}
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
						loading={isLoading && hasFetchedInitial}
						loadingIndicatorType="native"
						nativeLoadingColor="#357AFF"
					/>
				</View>
				{truncated && (
					<View style={styles.truncatedBanner} testID="my-dishes-map-truncated">
						<Text style={styles.truncatedText}>{i18n.t("MyDishes.map.truncated")}</Text>
					</View>
				)}
			</View>

			{showEmpty && (
				<View style={styles.emptyOverlay} pointerEvents={error ? "auto" : "none"}>
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
