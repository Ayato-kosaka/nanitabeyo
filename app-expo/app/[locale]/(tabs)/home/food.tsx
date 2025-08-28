import React from "react";
import { useLocalSearchParams, router } from "expo-router";
import FoodContentFeed from "@/components/FoodContentFeed";
import { mockDishItems } from "@/data/searchMockData";

export default function FoodScreen() {
	const { startIndex, returnTo } = useLocalSearchParams<{
		startIndex?: string;
		returnTo?: string;
	}>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;

	const handleIndexChange = (index: number) => {
		// Handle completion when reaching the last item
		if (index >= mockDishItems.length - 1 && returnTo) {
			setTimeout(() => {
				router.back();
			}, 1000);
		}
	};

	return (
		<FoodContentFeed
			key={`home-${isNaN(initialIndex) ? 0 : initialIndex}`}
			items={mockDishItems}
			initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
			onIndexChange={handleIndexChange}
		/>
	);
}
