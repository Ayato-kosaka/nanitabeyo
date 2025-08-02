import React from "react";
import { useLocalSearchParams } from "expo-router";
import FoodContentFeed from "@/components/FoodContentFeed";
import { foodItems } from "@/data/foodData";

export default function ProfileFoodScreen() {
	const { startIndex } = useLocalSearchParams<{ startIndex?: string }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;
	return <FoodContentFeed items={foodItems} initialIndex={isNaN(initialIndex) ? 0 : initialIndex} />;
}
