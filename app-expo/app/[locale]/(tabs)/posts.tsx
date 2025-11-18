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
	const { pushEntriesByKeyAsync } = useDishMediaEntriesStore();
	const source = "PostsScreen";

	useMemo(() => {
		const fetchData = async () => {
			const idArray =
				typeof ids === "string" ? ids.split(",") : Array.isArray(ids) ? ids.flatMap((v) => v.split(",")) : [];
			const requestPayload: QueryDishMediaByIdsDto = { ids: idArray };
			const response = callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
				method: "GET",
				requestPayload,
			});
			pushEntriesByKeyAsync(
				source,
				response.then((res) => res.items),
			);
		};
		fetchData();
	}, [ids, callBackend]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<DishMediaMap source={source} />
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
});
