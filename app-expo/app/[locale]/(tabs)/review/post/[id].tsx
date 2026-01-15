import React, { useEffect } from "react";
import { StyleSheet, ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft } from "lucide-react-native";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import { useAPICall } from "@/hooks/useAPICall";
import { useDishMediaEntriesStore, selectEntryByMediaId } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";

export default function ReviewPostScreen() {
	const { id } = useLocalSearchParams<{ id?: string }>();
	const { callBackend } = useAPICall();
	const locale = useLocale();
	const entriesKey = "ReviewPostScreen";

	// #644 【設計】ストアから DishMedia を取得（存在しない場合は API フェッチ）
	const entry = useDishMediaEntriesStore((state) => (id ? selectEntryByMediaId(id)(state) : null));

	useEffect(() => {
		if (!id) return;

		const { upsertDishMediaEntries, updateMediaIdsByKeyAsync, clearByKey } = useDishMediaEntriesStore.getState();

		// ストアに存在する場合はフェッチをスキップ
		if (entry) {
			updateMediaIdsByKeyAsync(entriesKey, Promise.resolve([id]), (_, fetchedIds) => fetchedIds);
			return;
		}

		// ストアに存在しない場合は API フェッチ
		const fetchData = async () => {
			const requestPayload: QueryDishMediaByIdsDto = { ids: [id] };
			const responsePromise = callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
				method: "GET",
				requestPayload,
			});
			const idsPromise = responsePromise.then((res) => {
				upsertDishMediaEntries(res.items);
				return res.items.map((item) => String(item.dish_media.id));
			});
			updateMediaIdsByKeyAsync(entriesKey, idsPromise, (_, fetchedIds) => fetchedIds);
		};

		fetchData();

		return () => {
			clearByKey(entriesKey);
		};
	}, [id, entry, callBackend]);

	// #644 【設計】戻るボタン押下時に /review/index に遷移
	const handleBack = () => {
		router.replace(`/${locale}/(tabs)/review/index`);
	};

	return (
		<>
			{/* #644 【設計】ヘッダーに戻るボタンを配置 */}
			<Stack.Screen
				options={{
					headerShown: true,
					headerTransparent: true,
					headerTitle: "",
					headerLeft: () => (
						<View style={styles.headerButton}>
							<ChevronLeft size={28} color="#FFFFFF" onPress={handleBack} />
						</View>
					),
				}}
			/>
			<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
				{/* #644 【設計】データ取得中はローディング表示 */}
				{!entry ? (
					<View style={styles.loadingContainer}>
						<ActivityIndicator size="large" color="#5EA2FF" />
					</View>
				) : (
					<DishMediaMap entriesKey={entriesKey} idType="dish_media" />
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
		marginLeft: 8,
		padding: 8,
	},
});
