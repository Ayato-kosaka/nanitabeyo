import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import { useAPICall } from "@/hooks/useAPICall";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";

export default function PostsScreen() {
	const { ids } = useLocalSearchParams<{ ids?: string | string[] }>();
	const { callBackend } = useAPICall();
	// #460 【設計】upsertDishMediaEntries + updateMediaIdsByKey に移行
	const { upsertDishMediaEntries, updateMediaIdsByKey } = useDishMediaEntriesStore();
	const clearByKey = useDishMediaEntriesStore((s) => s.clearByKey);
	const entriesKey = "PostsScreen";

	useMemo(() => {
		const fetchData = async () => {
			const idArray =
				typeof ids === "string" ? ids.split(",") : Array.isArray(ids) ? ids.flatMap((v) => v.split(",")) : [];
			const requestPayload: QueryDishMediaByIdsDto = { ids: idArray };
			// #460 【設計】Promise を await して upsertDishMediaEntries + updateMediaIdsByKey を呼ぶ
			try {
				const response = await callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
					method: "GET",
					requestPayload,
				});
				upsertDishMediaEntries(response.items);
				const mediaIds = response.items.map((item) => String(item.dish_media.id));
				updateMediaIdsByKey(entriesKey, () => mediaIds);
			} catch (error) {
				// エラーハンドリングは既存の挙動に合わせて省略（エラー状態は管理していない）
				console.error("Failed to fetch posts:", error);
			}
		};
		fetchData();
		return () => {
			clearByKey(entriesKey);
		};
	}, [ids, callBackend, upsertDishMediaEntries, updateMediaIdsByKey, clearByKey]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<DishMediaMap source={entriesKey} />
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
});
