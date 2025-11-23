import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { IdType } from "@/stores/useDishMediaEntriesStore";

export default function NotificationFeedScreen() {
	const { idType } = useLocalSearchParams<{ idType?: IdType }>();
	if (idType === undefined) throw new Error("idType is required in NotificationFeedScreen");

	return <DishMediaFeed entriesKey="notification" idType={idType} />;
}
