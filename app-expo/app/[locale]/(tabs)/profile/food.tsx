import React, { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { GroupName } from "@/features/profile/components/ProfileTabsBar";
import { DishMediaEntry } from "@shared/api/v1/res";
import { IdType } from "@/stores/useDishMediaEntriesStore";
// import { mockDishItems } from "@/data/searchMockData";

export default function ProfileFoodScreen() {
	const { startIndex, tabName } = useLocalSearchParams<{ startIndex?: string; tabName?: GroupName }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;
	
	// 【設計】tabName に応じて idType を決定
	const idType: IdType = tabName === "reviews" ? "dish_reviews" : "dish_media";

	return (
		<DishMediaFeed
			initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
			entriesKey={tabName || "profile"}
			idType={idType}
		/>
	);
}
