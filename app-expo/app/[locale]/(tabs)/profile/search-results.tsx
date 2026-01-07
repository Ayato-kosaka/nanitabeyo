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
				<View style={StyleSheet.absoluteFill} pointerEvents="auto">
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
