import React from "react";
import { useLocalSearchParams } from "expo-router";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { profileLikesEntriesKey } from "@/features/profile/tabs/LikeTab";
import { IdType } from "@/stores/useDishMediaEntriesStore";

/**
 * マイページ由来のグリッドから開く全画面フィード。
 *
 * #1402 【設計】このルートへ push するのは «いいねした投稿»（features/profile/tabs/LikeTab）だけになった。
 * 旧 ReviewTab（自分のレビュー）・SavedPostsTab（保存した投稿）からの導線は 4 グリッドタブごと廃止された。
 *
 * それに伴い #519 の `idType` 分岐（`tabName` が "reviews" / "profile-filtered-reviews" なら
 * `dish_reviews`）も落としている。残った唯一の呼び出し元が積むキーは `profileLikes` で、
 * これは `dish_media` 側のリストだから。ここへ `dish_reviews` 起点のグリッドを増やすときは、
 * 分岐ごと戻すのではなく «キーと idType の対応表» を持たせること（取り違えると
 * ストアから空の配列を引いて「開いたのに何も無い」になる）。
 */
type ProfileFeedKey = typeof profileLikesEntriesKey;

export default function ProfileFoodScreen() {
	const { startIndex, tabName } = useLocalSearchParams<{
		startIndex?: string;
		tabName?: ProfileFeedKey;
	}>();
	const initialIndex = startIndex ? parseInt(String(startIndex), 10) : 0;

	const idType: IdType = "dish_media";

	return (
		<DishMediaFeed
			initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
			entriesKey={tabName || "profile"}
			idType={idType}
		/>
	);
}
