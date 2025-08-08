import React from "react";
import { useLocalSearchParams } from "expo-router";
import FoodContentFeed from "@/components/FoodContentFeed";
import { mockDishItems } from "@/data/searchMockData";

export default function FoodScreen() {
	const { startIndex } = useLocalSearchParams<{ startIndex?: string }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;
	return <FoodContentFeed items={mockDishItems} initialIndex={isNaN(initialIndex) ? 0 : initialIndex} />;
}
