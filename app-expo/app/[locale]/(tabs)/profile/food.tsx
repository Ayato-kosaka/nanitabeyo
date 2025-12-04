import React, { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { GroupName } from "@/features/profile/components/ProfileTabsBar";
import { DishMediaEntry } from "@shared/api/v1/res";
import { IdType } from "@/stores/useDishMediaEntriesStore";
// import { mockDishItems } from "@/data/searchMockData";

// #519 【設計】フィルタ済みレビュー用のキー型を追加
type FilteredReviewKey = "profile-filtered-reviews";

export default function ProfileFoodScreen() {
	const { startIndex, tabName } = useLocalSearchParams<{
		startIndex?: string;
		tabName?: GroupName | FilteredReviewKey;
	}>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;

	// #519 【設計】tabName に応じて idType を決定（"reviews" または "profile-filtered-reviews" は dish_reviews を使用）
	const idType: IdType =
		tabName === "reviews" || tabName === "profile-filtered-reviews" ? "dish_reviews" : "dish_media";

	return (
		<DishMediaFeed
			initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
			entriesKey={tabName || "profile"}
			idType={idType}
		/>
	);
}
