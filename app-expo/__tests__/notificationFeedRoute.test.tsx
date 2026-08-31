/*
#1375（全画面のクラッシュ棚卸し）

**壊れた URL でアプリ全体を落とさない。**

以前この画面は `idType` が不正なら `throw new Error(...)` していた。render 中の throw は
`app/[locale]/_layout.tsx` の最終防波堤まで抜けるので、**アプリ全体が
«予期しないエラーが発生しました»** になる。しかも `idType` が付くのは通知一覧を
経由したときだけで、URL 直打ち・共有・ディープリンク・パラメータ落ちのいずれでも欠ける。

⚠️ ここが落ちたら、また普通の操作でアプリ全体が落ちる状態に戻っている。
*/
import React from "react";
import { act, create } from "react-test-renderer";

const mockParams: { current: Record<string, string | undefined> } = { current: {} };
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams.current }));
jest.mock("@/features/dishMedia/components/DishMediaFeed", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ idType }: { idType: string }) => ReactActual.createElement(RNView, { testID: `feed-${idType}` }),
	};
});
jest.mock("@/contexts/ThemeProvider", () => ({
	useThemedStyles: (factory: (c: Record<string, string>) => unknown) => factory({} as Record<string, string>),
}));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (k: string) => k } }));

import NotificationFeedScreen from "@/app/[locale]/(tabs)/notifications/feed";

const render = async () => {
	let tree!: ReturnType<typeof create>;
	await act(async () => {
		tree = create(<NotificationFeedScreen />);
	});
	return tree;
};
const has = (tree: ReturnType<typeof create>, testID: string) =>
	tree.root.findAll((n) => n.props?.testID === testID).length > 0;

it.each([
	["idType が無い（URL 直打ち・ディープリンク・パラメータ落ち）", {}],
	["idType が知らない値", { idType: "unknown_table" }],
])("%s は throw せず «見つかりません» を出す", async (_name, params) => {
	mockParams.current = params;
	const tree = await render();
	expect(has(tree, "notification-feed-not-found")).toBe(true);
});

it.each([["dish_media"], ["dish_reviews"]])("正しい idType（%s）ではフィードを描く", async (idType) => {
	mockParams.current = { idType };
	const tree = await render();
	expect(has(tree, `feed-${idType}`)).toBe(true);
});
