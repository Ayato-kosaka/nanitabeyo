/*
このファイルの責務
- **地図からお店を 1 件選んで、SNS 取り込み画面へ返す**ためだけの画面。

## なぜこの画面が要るのか（#1375 実機確認）

取り込み画面の店名検索（自前 `restaurants` テーブル）が空振りしたとき、文言は
「地図の店舗をタップしてお店を登録してください」と言っていたのに、**その地図がどこにも
無かった**。案内だけがあって導線が無い状態だったので、その地図をここに置く。

## 選び方は 2 つ（どちらも既存の仕組みで、Places の新規利用を増やさない）

1. 地図の POI（お店アイコン）をタップ … `onPoiClick` → `POST /v1/restaurants`
2. 上の検索から選ぶ … `LocationAutocomplete`（`select-restaurant.tsx` と同じ既存の部品）。
   飲食店の候補ならそのまま登録し、そうでなければ地図を動かすだけ

どちらも最終的に `POST /v1/restaurants`（`googlePlaceId` → 自前 `restaurants` に upsert）
を通る。**Google Places Text Search / Autocomplete をこの画面のために新設していない**
（`LocationAutocomplete` は `select-restaurant.tsx` が既に使っている経路そのもの）。

## 結果の返し方

`router.back()` はパラメータを持てないので、`usePickedRestaurantStore` に 1 回だけ置いて戻る。
取り込み画面が focus 時に `consume()` して受け取る（詳細はその store のコメント）。
*/
import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Navigation } from "lucide-react-native";
import { router } from "expo-router";
import MapViewClass from "react-native-maps";
import type { PoiClickEvent } from "react-native-maps";

import MapView, { type Region } from "@/components/MapView";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { INITIAL_REGION, REGION_JP } from "@/features/map/constants";
import { usePickedRestaurantStore } from "@/features/restaurantPicker/stores/usePickedRestaurantStore";
import i18n from "@/lib/i18n";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { ErrorCode, type AutocompleteLocation, type CreateRestaurantResponse } from "@shared/api/v1/res";
import type { CreateRestaurantDto } from "@shared/api/v1/dto";

export default function SnsImportPickRestaurantScreen() {
	useScreenTrace("SnsImportPickRestaurant");
	const { lightImpact } = useHaptics();
	const { locale, isJapanese } = useLocale();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();
	const { getLocationDetails, getCurrentLocation } = useLocationSearch();
	const setPicked = usePickedRestaurantStore((s) => s.setPicked);

	const mapRef = useRef<MapViewClass>(null);
	const initialRegion = useMemo<Region>(() => (isJapanese ? REGION_JP : INITIAL_REGION), [isJapanese]);
	const currentRegion = useRef<Region>(initialRegion);
	const [searchQuery, setSearchQuery] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	/** `googlePlaceId` から自前の `restaurants` を作り（あれば拾い）、選択として返して戻る */
	const pickByGooglePlaceId = useCallback(
		async (googlePlaceId: string) => {
			if (isCreating) return;
			setIsCreating(true);
			try {
				const response = await callBackend<CreateRestaurantDto, CreateRestaurantResponse>("v1/restaurants", {
					method: "POST",
					requestPayload: { googlePlaceId },
				});
				setPicked({ restaurantId: response.restaurant.id, name: response.restaurant.name });
				logFrontendEvent({
					event_name: "sns_import_restaurant_picked_on_map",
					error_level: "log",
					payload: { restaurant_id: response.restaurant.id },
				});
				showSnackbar(i18n.t("SnsImport.pickRestaurant.done", { name: response.restaurant.name }));
				// 取り込み画面はマウントされたまま（貼り付け済みの URL と選択済みの料理が残っている）
				router.back();
			} catch (rawError: unknown) {
				const error = rawError as ApiError;
				if (error.status === 422 && error.errorCode === ErrorCode.PLACE_NOT_FOOD_AND_DRINK) {
					showSnackbar(i18n.t("Map.errors.placeNotRestaurant"));
				} else if (error.status === 404) {
					showSnackbar(i18n.t("Map.errors.placeNotFound"));
				} else if (error.code === "network_error" || error.status === 0) {
					showSnackbar(i18n.t("Common.errors.network"));
				} else {
					showSnackbar(i18n.t("Common.errors.unexpected"));
				}
				logFrontendEvent({
					event_name: "sns_import_restaurant_pick_failed",
					error_level: "error",
					payload: { error, googlePlaceId },
				});
			} finally {
				setIsCreating(false);
			}
		},
		[callBackend, isCreating, logFrontendEvent, setPicked, showSnackbar],
	);

	const handlePoiPress = useCallback(
		(event: PoiClickEvent) => {
			lightImpact();
			void pickByGooglePlaceId(event.nativeEvent.placeId);
		},
		[lightImpact, pickByGooglePlaceId],
	);

	const handleAutocompleteSelect = useCallback(
		async (prediction: AutocompleteLocation) => {
			lightImpact();
			if (isFoodAndDrinkPlaceForUser(prediction)) {
				void pickByGooglePlaceId(prediction.place_id);
				return;
			}
			// 飲食店でない候補（駅・地名など）は «そこへ地図を動かす» だけ。選択にはしない
			try {
				const { location } = await getLocationDetails(prediction);
				const region = {
					latitude: location.latitude,
					longitude: location.longitude,
					latitudeDelta: 0.01,
					longitudeDelta: 0.01,
				};
				currentRegion.current = region;
				mapRef.current?.animateToRegion(region, 1000);
				setSearchQuery("");
			} catch (error) {
				logFrontendEvent({ event_name: "MapSearchError", error_level: "error", payload: { error, prediction } });
			}
		},
		[getLocationDetails, lightImpact, logFrontendEvent, pickByGooglePlaceId],
	);

	const handleCurrentLocation = useCallback(async () => {
		lightImpact();
		try {
			const { location } = await getCurrentLocation();
			const region = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			currentRegion.current = region;
			mapRef.current?.animateToRegion(region, 1000);
		} catch (error) {
			logFrontendEvent({ event_name: "MapCurrentLocationError", error_level: "error", payload: { error } });
		}
	}, [getCurrentLocation, lightImpact, logFrontendEvent]);

	return (
		<View style={styles.container} testID="sns-import-pick-restaurant-screen">
			<MapView
				ref={mapRef}
				style={styles.map}
				initialRegion={initialRegion}
				onRegionChangeComplete={(region: Region) => {
					currentRegion.current = region;
				}}
				onPoiClick={handlePoiPress}
			/>

			{isCreating && (
				<View style={styles.loadingOverlay} testID="sns-import-pick-restaurant-loading">
					<LoadingIndicator size="large" />
				</View>
			)}

			<View style={styles.topOverlay} pointerEvents="box-none">
				<ScreenHeader
					title={i18n.t("SnsImport.pickRestaurant.title")}
					onPressBack={() => {
						lightImpact();
						router.back();
					}}
					testID="sns-import-pick-restaurant-screen"
				/>

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
								testID="sns-import-pick-restaurant-current-location">
								<Navigation size={20} color="#000000" />
							</TouchableOpacity>
						}
					/>
				</View>

				{/* «何をすればよいか» を地図の上に 1 行だけ置く。地図だけ出して黙っていると、
				    POI をタップすれば選べることが分からない（1 巡目に実際そうなっていた） */}
				<View style={styles.hintBanner} pointerEvents="none">
					<Text style={styles.hintText} testID="sns-import-pick-restaurant-hint">
						{i18n.t("SnsImport.pickRestaurant.hint")}
					</Text>
				</View>
			</View>
		</View>
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
		borderLeftColor: "#C9C9C9",
	},
	hintBanner: {
		marginTop: 8,
		marginHorizontal: 16,
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 8,
		backgroundColor: "rgba(17, 24, 39, 0.85)",
	},
	hintText: {
		fontSize: 12,
		lineHeight: 17,
		color: "#FFFFFF",
	},
	loadingOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.3)",
		zIndex: 20,
	},
});
