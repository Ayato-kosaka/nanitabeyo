import { useLocalSearchParams } from "expo-router";
import { OpenInAppBanner } from "@/components/deepLinking/OpenInAppBanner";
import { DishCategoryGroupVoteVoteScreen } from "@/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteVoteScreen";

export default function DishCategoryGroupVoteVoteRoute() {
	const { shareToken: shareTokenParam } = useLocalSearchParams<{ shareToken: string | string[] }>();
	const shareToken = Array.isArray(shareTokenParam) ? (shareTokenParam[0] ?? "") : (shareTokenParam ?? "");

	return (
		<>
			{/* 共有リンクが Web に落ちた場合だけ、同じ投票先をアプリで開き直す導線を出す。 */}
			{shareToken.length > 0 ? <OpenInAppBanner path={`search/dish-category-group-votes/${shareToken}/vote`} /> : null}
			<DishCategoryGroupVoteVoteScreen shareToken={shareToken} />
		</>
	);
}
