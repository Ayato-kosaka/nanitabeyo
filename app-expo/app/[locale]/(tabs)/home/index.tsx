import React from "react";
import FoodContentFeed from "@/components/FoodContentFeed";
import { mockDishItems } from "@/data/searchMockData";

export default function HomeScreen() {
	return <FoodContentFeed items={mockDishItems} />;
}
