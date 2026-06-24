import { useLocalSearchParams } from "expo-router";
import { DishCategoryGroupVoteVoteScreen } from "@/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteVoteScreen";

export default function DishCategoryGroupVoteVoteRoute() {
	const { shareToken } = useLocalSearchParams<{ shareToken: string }>();

	return <DishCategoryGroupVoteVoteScreen shareToken={shareToken} />;
}
