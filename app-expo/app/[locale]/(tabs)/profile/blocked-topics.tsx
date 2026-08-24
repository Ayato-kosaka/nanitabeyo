/*
#1553 【設計】旧ルート `/{locale}/profile/blocked-topics` のリダイレクト。

実体は `profile/blocked-dish-categories` へ移した。経緯と消すときの手順は
`search/topics.tsx`（同じ #1553 のリダイレクト）の冒頭コメントを参照。
*/
import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

export default function LegacyBlockedTopicsRoute() {
	const params = useLocalSearchParams();
	return <Redirect href={{ pathname: "/[locale]/(tabs)/profile/blocked-dish-categories", params }} />;
}
