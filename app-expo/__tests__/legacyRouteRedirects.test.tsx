/*
#1553 【設計】旧 topic ルート → 新 dish-category ルートのリダイレクトを固定するテスト。

「アプリ内から topic という表現を消す」でルート名を改名した。旧ルートは既存の
共有リンク・ブックマーク・検索エンジンのインデックスが踏むため、Redirect だけを持つ
画面として残してある（消してよいかはオーナー判断）。ここが守るのは 2 点。

1. 旧ルートを開くと、対応する新ルートへ（locale を含めて）リダイレクトされること
2. クエリ・パラメータを削らずに運ぶこと（#1272 で «クエリを落とす» 事故を三度起こした箇所）

`app/` 配下に置くと expo-router がルートとして拾ってしまうため、ここに置いている
（profileEditRoute.test.tsx と同じ理由）。
*/
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

// Redirect を「押された href を記録するだけの器」に差し替える
const capturedHrefs: { pathname: string; params?: Record<string, string> }[] = [];
jest.mock("expo-router", () => ({
	Redirect: ({ href }: { href: { pathname: string; params?: Record<string, string> } }) => {
		capturedHrefs.push(href);
		return null;
	},
	useLocalSearchParams: () => mockParams,
}));

let mockParams: Record<string, string> = {};

import LegacyTopicsRoute from "../app/[locale]/(tabs)/search/topics";
import LegacySavedTopicsRoute from "../app/[locale]/(tabs)/profile/saved-topics";
import LegacyBlockedTopicsRoute from "../app/[locale]/(tabs)/profile/blocked-topics";
import LegacySavedTopicLocationRoute from "../app/[locale]/(tabs)/profile/saved-topic-location";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	await act(async () => {
		tree.unmount();
	});
};

beforeEach(() => {
	capturedHrefs.splice(0);
	mockParams = { locale: "ja-JP" };
});

describe("#1553 旧 topic ルートのリダイレクト", () => {
	it.each([
		["search/topics", <LegacyTopicsRoute key="t" />, "/[locale]/(tabs)/search/dish-categories"],
		["profile/saved-topics", <LegacySavedTopicsRoute key="s" />, "/[locale]/(tabs)/profile/saved-dish-categories"],
		["profile/blocked-topics", <LegacyBlockedTopicsRoute key="b" />, "/[locale]/(tabs)/profile/blocked-dish-categories"],
		[
			"profile/saved-topic-location",
			<LegacySavedTopicLocationRoute key="l" />,
			"/[locale]/(tabs)/profile/saved-dish-category-location",
		],
	])("%s は新ルートへ locale 付きでリダイレクトする", async (_route, element, expectedPathname) => {
		await render(element);

		expect(capturedHrefs).toHaveLength(1);
		expect(capturedHrefs[0]).toEqual({
			pathname: expectedPathname,
			params: { locale: "ja-JP" },
		});
	});

	// クエリは行き先の一部（deepLinkTarget.ts の #1272 参照）。旧 URL に付いていたクエリを
	// リダイレクトで落とすと、直リンクの着地条件が変わってしまう
	it("クエリ・パラメータを削らずに新ルートへ運ぶ", async () => {
		mockParams = { locale: "en-US", searchParams: '{"address":"Shibuya"}' };

		await render(<LegacyTopicsRoute />);

		expect(capturedHrefs[0]).toEqual({
			pathname: "/[locale]/(tabs)/search/dish-categories",
			params: { locale: "en-US", searchParams: '{"address":"Shibuya"}' },
		});
	});
});
