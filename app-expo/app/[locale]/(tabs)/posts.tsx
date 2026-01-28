import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import { useAPICall } from "@/hooks/useAPICall";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { OpenInAppBanner } from "@/components/deepLinking/OpenInAppBanner";
import { useSeo } from "@/contexts/SeoContext";
import i18n from "@/lib/i18n";

export default function PostsScreen() {
	const { ids } = useLocalSearchParams<{ ids?: string | string[] }>();
	const { callBackend } = useAPICall();
	const entriesKey = "PostsScreen";

	// #717 【設計】useSeo で投稿画面のSEO情報を上書き（フォーカス連動で自動解除）
	// #717 【設計】i18n を使用して多言語対応（ハードコードではなく翻訳キー使用）
	useSeo({
		title: i18n.t("Posts.title", { defaultValue: "料理の投稿 | なに食べよ" }),
		description: i18n.t("Posts.description", {
			defaultValue: "ユーザーが投稿した料理の写真とレビューをご覧ください。",
		}),
	});

	useEffect(() => {
		const { upsertDishMediaEntries, updateMediaIdsByKeyAsync, clearByKey } = useDishMediaEntriesStore.getState();
		const fetchData = async () => {
			const idArray =
				typeof ids === "string" ? ids.split(",") : Array.isArray(ids) ? ids.flatMap((v) => v.split(",")) : [];
			const requestPayload: QueryDishMediaByIdsDto = { ids: idArray };
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
	}, [ids, callBackend]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* #688 【設計】Web Deep Linking バナー（アプリ未インストール時の導線） */}
			<OpenInAppBanner path="posts" params={{ ids }} />
			<DishMediaMap entriesKey={entriesKey} idType="dish_media" />
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
});
