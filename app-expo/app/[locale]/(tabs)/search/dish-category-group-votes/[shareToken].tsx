import { useLocalSearchParams } from "expo-router";
import { DishCategoryGroupVoteResultScreen } from "@/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteResultScreen";

export default function DishCategoryGroupVoteResultRoute() {
	const { shareToken } = useLocalSearchParams<{ shareToken: string }>();

	return <DishCategoryGroupVoteResultScreen shareToken={shareToken} />;
}
