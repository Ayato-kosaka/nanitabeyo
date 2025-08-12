import React, { useEffect } from "react";
import FoodContentFeed from "@/components/FoodContentFeed";
import { mockDishItems } from "@/data/searchMockData";
import { useLogger } from "@/hooks/useLogger";

export default function HomeScreen() {
	const { logFrontendEvent } = useLogger();

	useEffect(() => {
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: { screen: "home", itemCount: mockDishItems.length },
		});
	}, [logFrontendEvent]);

	return <FoodContentFeed items={mockDishItems} />;
}
