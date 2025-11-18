import React, { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { GroupName } from "@/features/profile/components/ProfileTabsBar";
import { DishMediaEntry } from "@shared/api/v1/res";
// import { mockDishItems } from "@/data/searchMockData";

export default function ProfileFoodScreen() {
	const { startIndex, tabName } = useLocalSearchParams<{ startIndex?: string; tabName?: GroupName }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;

	const keyExtractor = useMemo(
		() => (tabName === "reviews" ? (item: DishMediaEntry) => String(item.dish_reviews[0]?.id) : undefined),
		[tabName],
	);

	return (
		<DishMediaFeed
			initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
			source={tabName || "profile"}
			keyExtractor={keyExtractor}
		/>
	);
}
