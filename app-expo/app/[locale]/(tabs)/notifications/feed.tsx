import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { IdType } from "@/stores/useDishMediaEntriesStore";

export default function NotificationFeedScreen() {
	const { idType } = useLocalSearchParams<{ idType?: string }>();
	if (idType !== "dish_media" && idType !== "dish_reviews") {
		throw new Error(`Invalid idType: ${idType}. Expected "dish_media" or "dish_reviews"`);
	}

	return <DishMediaFeed entriesKey="notification" idType={idType} />;
}
