import React, { useCallback, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { X } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import { LinearGradient } from "expo-linear-gradient";
import { useSearchResult } from "@/features/search/hooks/useSearchResult";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { DishMediaEntriesStore, selectIdsByKey, useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { shallow } from "zustand/shallow";
import { RestaurantLoading } from "@/features/dishMedia/components/RestaurantLoading";

export default function ResultScreen() {
	const { topicId, location } = useLocalSearchParams<{ topicId: string; location?: string }>();
	const selector = useCallback(
		(state: DishMediaEntriesStore) => selectIdsByKey(topicId, "dish_media")(state),
		[topicId],
	);
	const { isLoading } = useDishMediaEntriesStore(selector, shallow);
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
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const { currentIndex, showCompletionModal, handleIndexChange, handleClose, handleReturnToCards } = useSearchResult(
		topicId as string,
	);

	useEffect(() => {
		// Log screen view with search parameters
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: {
				screen: "search_result",
				topicId,
				hasTopicId: !!topicId,
			},
		});
	}, [topicId, logFrontendEvent]);

	const handleCloseWithHaptic = () => {
		lightImpact();
		logFrontendEvent({
			event_name: "search_result_closed",
			error_level: "log",
			payload: { topicId, currentIndex },
		});
		handleClose();
	};

	// #420 【仕様】店舗5件のローディング画面 - 必要データ（リスト＋サムネイル最低1枚）事前読み込み未完了の場合のみ表示
	if (isLoading) return <RestaurantLoading />;

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
			<DishMediaMap onIndexChange={handleIndexChange} initialLocation={initialLocation} entriesKey={topicId} />
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
