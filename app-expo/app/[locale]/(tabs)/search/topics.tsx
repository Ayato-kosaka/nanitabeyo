/*
#1553 【設計】旧ルート `/{locale}/search/topics` のリダイレクト。

「アプリ内から topic という表現を消す」（#1553）で実体は `search/dish-categories` へ移した。
このファイルは、既存の共有リンク・ブックマーク・検索エンジンのインデックスが踏む
旧 URL を新ルートへ運ぶためだけに残している。**新しい導線からここへ遷移させないこと。**

旧ルートを消してよいかはオーナー判断（PR で確認中）。消すときはこのファイルと
`search/_layout.tsx` の `name="topics"`、`lib/seo/publicRoutes.ts` の除外エントリ、
`__tests__/legacyRouteRedirects.test.tsx` を一緒に消す。
*/
import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

export default function LegacyTopicsRoute() {
	// クエリ・パラメータは行き先の一部（deepLinkTarget.ts の #1272 と同じ判断）。削らずに運ぶ
	const params = useLocalSearchParams();
	return <Redirect href={{ pathname: "/[locale]/(tabs)/search/dish-categories", params }} />;
}
