// #1477 【バグ】`/posts?ids=` の値は URL のクエリそのもので、信用できない。
//
// 本番（2026-08-20T15:12:39Z / ヒンディー語環境の 1 ユーザー）の実測:
//   {"endpoint":"https://api.nanitabeyo.net/v1/dish-media?ids=","status":400,
//    "requestPayload":{"ids":[]},
//    "errorPayload":{"errorCode":"VALIDATION_ERROR","message":"each value in ids must be a UUID"}}
//
// ids 無しで開いたため `{ ids: [] }` を送り、`?ids=` として直列化され、サーバの Transform が
// `"".split(",")` で `[""]` にしたため `@IsUUID` が落ちた。その 400 は握り潰されず
// DishMediaMap のオーバーレイに出るので、**英語の内部バリデーション文が画面に出ていた**。
//
// ここで固定するのは 2 つ。「送る前に弾く」ことと、「弾いたときに何を見せるか」。
import React from "react";
import TestRenderer from "react-test-renderer";

jest.mock("expo-linear-gradient", () => {
	const { View: RNView } = require("react-native");
	return { LinearGradient: RNView };
});
jest.mock("@/features/dishMedia/components/DishMediaMap", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/deepLinking/OpenInAppBanner", () => ({ OpenInAppBanner: () => null }));
jest.mock("@/contexts/SeoContext", () => ({ useSeo: () => {} }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key, locale: "ja-JP" } }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => {
	const value = { callBackend: (...args: unknown[]) => mockCallBackend(...(args as [])) };
	return { useAPICall: () => value };
});

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => {
	const value = { logFrontendEvent: (event: unknown) => mockLogFrontendEvent(event) };
	return { useLogger: () => value };
});

// ⚠️ 戻り値の参照を固定すること（毎回新しい関数を返すとレンダーが収束しない）
jest.mock("@/stores/useDishMediaEntriesStore", () => {
	const state = {
		upsertDishMediaEntries: jest.fn(),
		updateMediaIdsByKeyAsync: jest.fn(),
		clearByKey: jest.fn(),
	};
	return { useDishMediaEntriesStore: Object.assign(() => ({}), { getState: () => state }) };
});

let mockParams: Record<string, string | string[] | undefined> = {};
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams }));

import PostsScreen from "@/app/[locale]/(tabs)/posts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VALID_ID = "e2731728-3ee1-404b-8e0d-966cd5259fdc";
const OTHER_ID = "0a6797a3-bffc-40bd-b878-73176b37fc89";

const render = (): TestRenderer.ReactTestRenderer => {
	let created: TestRenderer.ReactTestRenderer | undefined;
	TestRenderer.act(() => {
		created = TestRenderer.create(<PostsScreen />);
	});
	return created!;
};

const findLoggedEvent = (eventName: string) =>
	mockLogFrontendEvent.mock.calls
		.map(([e]) => e as { event_name: string; error_level: string })
		.find((e) => e.event_name === eventName);

describe("#1477 /posts の ids ガード", () => {
	let tree: TestRenderer.ReactTestRenderer | undefined;

	beforeEach(() => {
		jest.clearAllMocks();
		mockCallBackend.mockResolvedValue({ items: [] });
	});

	afterEach(() => {
		if (tree) {
			TestRenderer.act(() => tree!.unmount());
			tree = undefined;
		}
	});

	it.each([
		["ids そのものが無い", undefined],
		["空文字（?ids= の実測ケース）", ""],
		["UUID ではない値", "not-a-uuid"],
		["区切りだけ", ",,"],
	])("%s なら API を呼ばず「見つかりません」を出す", (_label, ids) => {
		mockParams = { locale: "ja-JP", ids };
		tree = render();

		// ここが通ると 400 になり、その本文が画面に出る
		expect(mockCallBackend).not.toHaveBeenCalled();
		expect(tree.root.findAllByProps({ testID: "posts-not-found" }).length).toBeGreaterThan(0);

		// 壊れた URL を開かれただけなのでアプリは壊れていない = warn
		expect(findLoggedEvent("posts_ids_invalid")?.error_level).toBe("warn");
	});

	it("正常な UUID なら従来どおり API を呼ぶ（ガードが正常系を止めていないこと）", () => {
		mockParams = { locale: "ja-JP", ids: VALID_ID };
		tree = render();

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).toHaveBeenCalledWith(
			"v1/dish-media",
			expect.objectContaining({ requestPayload: { ids: [VALID_ID] } }),
		);
		expect(findLoggedEvent("posts_ids_invalid")).toBeUndefined();
	});

	it("壊れた値が混ざっていても、有効な UUID だけを送る", () => {
		mockParams = { locale: "ja-JP", ids: `${VALID_ID},not-a-uuid,${OTHER_ID}` };
		tree = render();

		expect(mockCallBackend).toHaveBeenCalledWith(
			"v1/dish-media",
			expect.objectContaining({ requestPayload: { ids: [VALID_ID, OTHER_ID] } }),
		);
	});
});
