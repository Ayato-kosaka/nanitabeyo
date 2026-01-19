import React, { useEffect, useState } from "react";
import { StyleSheet, ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft } from "lucide-react-native";
import { useAPICall } from "@/hooks/useAPICall";
import {
	useDishMediaEntriesStore,
	NormalizedDishMediaEntry,
	selectEntryByReviewId,
} from "@/stores/useDishMediaEntriesStore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";

export default function ReviewPostScreen() {
	const { id: dishReviewId } = useLocalSearchParams<{ id?: string }>();
	const { callBackend } = useAPICall();
	const insets = useSafeAreaInsets();
	const entriesKey = "ReviewPostScreen";
	const [dishMediaEntry, setDishMediaEntry] = useState<NormalizedDishMediaEntry | null>(null);

	useEffect(() => {
		if (!dishReviewId) return;

		// #644 【設計】ストアから DishMedia を取得（存在しない場合は API フェッチ）
		const entry = selectEntryByReviewId(dishReviewId)(useDishMediaEntriesStore.getState());

		const { updateReviewIdsByKey, clearByKey } = useDishMediaEntriesStore.getState();

		// ストアに存在する場合はフェッチをスキップ
		if (entry) {
			updateReviewIdsByKey(entriesKey, () => [dishReviewId]);
			setDishMediaEntry(entry);
			return;
		}

		// reviewId から取れないのでコメントアウト
		// ストアに存在しない場合は API フェッチ
		// const fetchData = async () => {
		// 	const requestPayload: QueryDishMediaByIdsDto = { ids: [id] };
		// 	const response = await callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
		// 		method: "GET",
		// 		requestPayload,
		// 	});
		// 	upsertDishMediaEntries(response.items);
		// 	updateMediaIdsByKey(entriesKey, () => [id]);
		// 	const fetchedEntry = selectEntryByMediaId(id)(useDishMediaEntriesStore.getState());
		// 	setDishMediaEntry(fetchedEntry || null);
		// };

		// fetchData();

		return () => {
			clearByKey(entriesKey);
		};
	}, [dishReviewId, callBackend]);

	// #644 【設計】戻るボタン押下時に /review/index に遷移
	const handleBack = () => {
		router.back();
	};

	return (
		<>
			<View style={[styles.headerButton, { top: insets.top + 8 }]}>
				<ChevronLeft size={28} color="#FFFFFF" onPress={handleBack} />
			</View>
			<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
				{/* #644 【設計】データ取得中はローディング表示 */}
				{!dishMediaEntry ? (
					<View style={styles.loadingContainer}>
						<ActivityIndicator size="large" color="#F05537" />
					</View>
				) : (
					<DishMediaFeed entriesKey={entriesKey} idType="dish_reviews" />
				)}
			</LinearGradient>
		</>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	headerButton: {
		position: "absolute",
		left: 16,
		zIndex: 10,
		backgroundColor: "rgba(0,0,0,0.4)",
		borderRadius: 24,
		marginLeft: 8,
		padding: 8,
	},
});
