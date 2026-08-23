import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import { useAPICall } from "@/hooks/useAPICall";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { OpenInAppBanner } from "@/components/deepLinking/OpenInAppBanner";
import { useSeo } from "@/contexts/SeoContext";
import i18n from "@/lib/i18n";
import { SeoOverride } from "@/contexts/SeoContext/SeoProvider";
import { resolvePublicLocale, SITE_NAME_BY_PUBLIC_LOCALE } from "@/constants/seoLocales";

export default function PostsScreen() {
	const { ids, entriesKey: entriesKeyParam } = useLocalSearchParams<{
		ids?: string | string[];
		entriesKey?: string | string[];
	}>();
	const { callBackend } = useAPICall();
	const entriesKey =
		typeof entriesKeyParam === "string" && entriesKeyParam.length > 0 ? entriesKeyParam : "PostsScreen";

	const [seoData, setSeoData] = useState<SeoOverride["data"]>({});

	// #717 【設計】useSeo で投稿画面のSEO情報を上書き（フォーカス連動で自動解除）
	// #717 【設計】i18n を使用して多言語対応（ハードコードではなく翻訳キー使用）
	useSeo(seoData);

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
				// SEOデータの設定
				res.items.length > 0 &&
					setSeoData({
						title: SITE_NAME_BY_PUBLIC_LOCALE[resolvePublicLocale(i18n.locale)] + " - " + res.items[0].restaurant.name,
						...(res.items[0].dish_reviews.length > 0 ? { description: res.items[0].dish_reviews[0].comment } : {}),
						image: res.items[0].dish_media.thumbnailImageUrl ?? undefined,
						imageAlt: res.items[0].restaurant.name,
					});

				// ストアにデータを格納
				upsertDishMediaEntries(res.items);
				return res.items.map((item) => String(item.dish_media.id));
			});
			updateMediaIdsByKeyAsync(entriesKey, idsPromise, (_, fetchedIds) => fetchedIds);
		};
		fetchData();
		return () => {
			clearByKey(entriesKey);
		};
	}, [callBackend, entriesKey, ids]);

	// #721 testID は共有リンク（/s/:token）が «捨てられず投稿画面へ着地したか» を E2E から見るための目印。
	// 解決画面は resolve の往復の間しか出ず観測できないため、着地先そのものを観測点にしている。見た目には影響しない
	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container} testID="posts-screen">
			{/* #688 【設計】Web Deep Linking バナー（アプリ未インストール時の導線） */}
			<OpenInAppBanner path="posts" params={{ ids, entriesKey }} />
			<DishMediaMap entriesKey={entriesKey} idType="dish_media" />
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
});
