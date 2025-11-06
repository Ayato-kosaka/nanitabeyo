import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import { useAPICall } from "@/hooks/useAPICall";

export default function PostsScreen() {
	const { ids } = useLocalSearchParams<{ ids?: string | string[] }>();
	const { callBackend } = useAPICall();

	const dishesPromise = useMemo(async () => {
		const idArray =
			typeof ids === "string" ? ids.split(",") : Array.isArray(ids) ? ids.flatMap((v) => v.split(",")) : [];
		const requestPayload: QueryDishMediaByIdsDto = { ids: idArray };
		const response = await callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
			method: "GET",
			requestPayload,
		});
		return response.items;
	}, [ids]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<DishMediaMap itemsPromise={dishesPromise} source="PostsScreen" />
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
});
