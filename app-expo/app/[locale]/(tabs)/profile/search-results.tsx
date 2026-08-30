import React, { useCallback, useEffect } from "react";
import { View, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import { LinearGradient } from "expo-linear-gradient";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { RestaurantLoading } from "@/features/dishMedia/components/RestaurantLoading";
import { DishMediaEntriesStore, selectIdsByKey, useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

const idType = "dish_media" as const;
export default function ProfileSearchResultScreen() {
	const { entriesKey } = useLocalSearchParams<{ entriesKey: string }>();
	const selector = useCallback(
		(state: DishMediaEntriesStore) => selectIdsByKey(entriesKey, idType)(state),
		[entriesKey],
	);
	const { isLoading } = useDishMediaEntriesStore(selector, shallow);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);

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
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			{/* Header with Back Button */}
			<View style={{ ...styles.closeButtonContainer, top: Platform.OS === "ios" ? 40 : 0 }}>
				{/* #1133 この画面には testID を持つ要素が 1 つも無く、E2E から「ここへ着いた」ことを
				    観測できなかった。地図やリストは読み込み状態で見た目が変わるため、常に描画される
				    閉じるボタンを到達判定の観測点にする（見た目は変わらない） */}
				<TouchableOpacity
					style={styles.closeButton}
					onPress={handleCloseWithHaptic}
					testID="profile-search-result-close-button">
					<X size={24} color={colors.textStrong} />
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

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
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
			backgroundColor: c.surface,
			// 影はテーマに依らず黒。暗面では実質見えないだけで、値としては黒のままでよい
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.3,
			shadowRadius: 12,
			elevation: 6,
		},
	});
