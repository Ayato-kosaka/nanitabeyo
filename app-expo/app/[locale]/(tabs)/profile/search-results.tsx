import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { RestaurantLoading } from "@/features/dishMedia/components/RestaurantLoading";
import { DishMediaEntriesStore, selectIdsByKey, useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { useGoogleMapsFallback } from "@/features/search/hooks/useGoogleMapsFallback";

const idType = "dish_media" as const;
export default function ProfileSearchResultScreen() {
	// #1243 【設計】location / category は SavedTopicsTab が push 時に渡す。
	// search/result.tsx と同じ形（location は JSON 文字列の {latitude, longitude}）。
	const { entriesKey, location, category } = useLocalSearchParams<{
		entriesKey: string;
		location?: string;
		category?: string;
	}>();
	const selector = useCallback(
		(state: DishMediaEntriesStore) => selectIdsByKey(entriesKey, idType)(state),
		[entriesKey],
	);
	const { ids, isLoading } = useDishMediaEntriesStore(selector, shallow);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { showGoogleMapsFallbackDialog } = useGoogleMapsFallback({ source: "profile_search_result_screen" });
	const shownGoogleMapsFallbackKeyRef = useRef<string | null>(null);

	const initialLocation = useMemo(() => {
		if (typeof location === "string") {
			try {
				return JSON.parse(location) as { latitude: number; longitude: number };
			} catch {
				return undefined;
			}
		}
		return undefined;
	}, [location]);

	useEffect(() => {
		// Log screen view with search parameters
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: {
				screen: "search_result",
				entriesKey,
			},
		});
	}, [entriesKey, logFrontendEvent]);

	useEffect(() => {
		// #1243 【設計】保存トピック経由（SavedTopicsTab → この画面）にも Google Maps 退避導線を用意する。
		// #1196 のレビューで、bulk-import が失敗する 3 つの入口のうち**この経路だけ退避導線が無く**、
		// クォータ枯渇時にユーザーが行き止まりになることが分かったため。
		//
		// 発火条件・重複抑止・表示後に閉じる挙動は app/[locale]/(tabs)/search/result.tsx の写し。
		// 新しい UX を作らないこと（あちらは 115 人/日が実際に使っている導線で、条件は #1196 でも変えていない）。
		// #828 【設計】0件確定後の退避導線は、取得元ではなく検索結果画面の責務として扱う。
		if (!entriesKey || isLoading || ids.length > 0 || !initialLocation || !category) return;

		// 同じ0件結果の再レンダーでは重複表示せず、新しい検索条件では再度 fallback を出す。
		const fallbackKey = `${entriesKey}:${category}:${typeof location === "string" ? location : ""}`;
		if (shownGoogleMapsFallbackKeyRef.current === fallbackKey) return;
		shownGoogleMapsFallbackKeyRef.current = fallbackKey;

		showGoogleMapsFallbackDialog({
			entriesKey,
			category,
			location: initialLocation,
			locale,
		});

		// #828 【設計】表示できる店舗がない場合、保存トピック一覧へ戻す。
		// iOS で、react-native-paper の Portal.Host が transparentModal より下にあるため、この位置。
		// この画面には useSearchResult（= handleClose）が無いので router.back() を直接呼ぶ。
		router.back();
	}, [category, entriesKey, ids.length, initialLocation, isLoading, locale, location, showGoogleMapsFallbackDialog]);

	const handleCloseWithHaptic = () => {
		lightImpact();
		logFrontendEvent({
			event_name: "search_result_closed",
			error_level: "log",
			payload: { entriesKey },
		});
		router.back();
	};

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header with Back Button */}
			<View style={{ ...styles.closeButtonContainer, top: Platform.OS === "ios" ? 40 : 0 }}>
				<TouchableOpacity style={styles.closeButton} onPress={handleCloseWithHaptic}>
					<X size={24} color="#000" />
				</TouchableOpacity>
			</View>

			{/* Feed Content */}
			{/* <DishMediaFeed items={dishes} onIndexChange={handleIndexChange} /> */}
			<DishMediaMap entriesKey={entriesKey} idType="dish_media" />

			{/* #420 店舗5件のローディング画面 - 必要データ（リスト＋サムネイル最低1枚）事前読み込み未完了の場合のみ表示 */}
			{isLoading && (
				<View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="auto">
					<RestaurantLoading />
				</View>
			)}
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	closeButtonContainer: {
		position: "absolute",
		right: 0,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		padding: 16,
		zIndex: 10,
	},
	closeButton: {
		padding: 8,
		borderRadius: 24,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
	},
});
