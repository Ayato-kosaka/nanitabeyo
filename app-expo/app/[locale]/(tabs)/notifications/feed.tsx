import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";

export default function NotificationFeedScreen() {
	const { startIndex } = useLocalSearchParams<{ startIndex?: string }>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;

	return (
		<DishMediaFeed
			initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
			entriesKey="notification"
			idType="dish_media"
		/>
	);
}
