/*
#1553 【設計】旧ルート `/{locale}/profile/saved-topic-location` のリダイレクト。

実体は `profile/saved-dish-category-location` へ移した。経緯と消すときの手順は
`search/topics.tsx`（同じ #1553 のリダイレクト）の冒頭コメントを参照。
*/
import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

export default function LegacySavedTopicLocationRoute() {
	const params = useLocalSearchParams();
	return <Redirect href={{ pathname: "/[locale]/(tabs)/profile/saved-dish-category-location", params }} />;
}
