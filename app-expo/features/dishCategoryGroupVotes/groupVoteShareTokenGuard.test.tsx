// #1376 【設計】友達投票を開くときの shareToken ガードのテスト。
//
// 背景: `router.push({ pathname: ".../[shareToken]", params: { shareToken } })` は、
// shareToken が undefined / 空文字だと expo-router が動的セグメントを解決できず
// **`[shareToken]` というリテラルのまま** URL に残す。その URL でサーバへ問い合わせると
// `getDetailByShareToken` が 404 を返し、`DishCategoryGroupVotes.getDetailFailed` が error で記録される。
// 本番ログに実際に `shareToken: "[shareToken]"` が届いており、認証済みユーザー 4 人が踏んでいた。
//
// このガードは「router.push させない」ことが本体なので、純関数の単体テストでは捕まえられない
// （関数が正しくても handleOpenGroupVote から呼ばれなければ意味がない）。ここで配線を固定する。
//
// ⚠️ もう一つの本質は **ref の解除**。`isOpeningGroupVoteRef` は「遷移したら解除しない
// （遷移先の useFocusEffect が解除する）」設計なので、遷移せずに抜ける経路で解除を忘れると
// ボタンが二度と押せなくなる（#1205 と同じ罠）。押し直せることまで検証する。
import React from "react";
import TestRenderer from "react-test-renderer";

// 周辺依存のスタブ方針は searchScreenPreload.test.tsx / overseasSearchGuard.test.tsx と同じ
// (画面が AuthProvider → lib/supabase → constants/Env まで芋づるに読み込むため、断ち切らないと suite ごと落ちる)
jest.mock("expo-image", () => ({ Image: function MockExpoImage() {} }));
jest.mock(
	"lucide-react-native",
	() =>
		new Proxy(
			{},
			{
				get: (_target, prop) => (prop === "__esModule" ? true : function MockIcon() {}),
			},
		),
);
jest.mock("react-native-reanimated-carousel", () => ({ __esModule: true, default: function MockCarousel() {} }));
jest.mock("@react-navigation/native", () => ({ useFocusEffect: () => {}, useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => {
	const { View: RNView } = require("react-native");
	return { SafeAreaView: RNView };
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => {
	const value = { lightImpact: () => {}, mediumImpact: () => {}, selectionChanged: () => {} };
	return { useHaptics: () => value };
});
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: jest.fn() }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/contexts/DialogProvider", () => {
	const value = { showDialog: () => {}, confirm: () => Promise.resolve(true) };
	return { useDialog: () => value };
});
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: Object.assign(() => ({}), {
		getState: () => ({ setDishMediaEntries: jest.fn(), updateDishCategoryIdsByKey: jest.fn() }),
	}),
}));
jest.mock("@/features/dishCategories/hooks/useBlockDishCategory", () => {
	const value = { handleBlockCard: () => {} };
	return { useBlockDishCategory: () => value };
});
jest.mock("@/features/dishCategories/hooks/useDishCategoryCardSize", () => {
	const value = { cardWidth: 300, cardMaxHeight: 500 };
	return { useDishCategoryCardSize: () => value };
});
jest.mock("@/features/dishCategories/hooks/useDishCategoryImageResources", () => {
	const state = { status: "loaded" as const };
	const value = { getImageState: () => state, retryImage: () => {}, markImageError: () => {} };
	return { useDishCategoryImageResources: () => value };
});
jest.mock("@/features/dishCategories/hooks/useDishCategoriesTutorial", () => {
	const value = {
		hasSeenTutorial: true,
		isTutorialRequested: false,
		tutorialRequestId: 0,
		openReason: "manual",
		openManually: () => {},
		close: () => {},
		markPresented: () => {},
	};
	return { useDishCategoriesTutorial: () => value };
});
jest.mock("@/features/dishCategories/components/DishCategoryCard", () => ({
	DishCategoryCard: () => null,
	DISH_CATEGORY_CARD_CTA_OVERHANG: 0,
}));
jest.mock("@/features/dishCategories/components/DishCategoryThumbnail", () => ({ DishCategoryThumbnail: () => null }));
jest.mock("@/features/dishCategories/components/DishCategoriesLoading", () => ({ DishCategoriesLoading: () => null }));
jest.mock("@/features/dishCategories/components/DishCategoriesError", () => ({ DishCategoriesError: () => null }));
jest.mock("@/features/dishCategories/components/DishCategoriesSpotlightTutorial", () => ({ DishCategoriesSpotlightTutorial: () => null }));
// ScreenHeader は rightContent（＝友達投票ボタンの置き場）を描かないとテスト対象へ到達できない
jest.mock("@/components/ScreenHeader", () => ({
	ScreenHeader: ({ rightContent }: { rightContent?: React.ReactNode }) => rightContent ?? null,
}));

// jest.mock のファクトリはホイストされるため、外側の変数は `mock` プレフィックスのものしか参照できない。
// ⚠️ `push: mockRouterPush` と直接書かないこと（overseasSearchGuard.test.tsx と同じ TDZ の罠）。
const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
	router: { push: (...args: unknown[]) => mockRouterPush(...(args as [])), back: jest.fn(), replace: jest.fn() },
	useLocalSearchParams: () => ({
		locale: "ja-JP",
		searchParams: JSON.stringify({
			timeSlot: "lunch",
			scene: "solo",
			address: "country:JP",
			distance: 1000,
			priceLevels: [],
			locationQuery: "テスト地点",
			location: { latitude: 34.6937, longitude: 135.5023 },
			localLanguageCode: "ja",
		}),
	}),
}));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

// 友達投票の作成 API。テストごとに返す shareToken を差し替える
const mockCreateGroupVote = jest.fn();
jest.mock("@/features/dishCategoryGroupVotes/hooks/useCreateDishCategoryGroupVote", () => ({
	useCreateDishCategoryGroupVote: () => ({
		createGroupVote: (...args: unknown[]) => mockCreateGroupVote(...(args as [])),
		isCreating: false,
	}),
}));

// カルーセルが立ち上がるよう dishCategory を 1 件返す。
// ⚠️ **戻り値の参照を固定すること。** 毎回新しい配列 / 関数を返すと画面の useMemo・useEffect の
// 依存が毎レンダー変わり、レンダーが収束せずテストがタイムアウトする（実際に踏んだ）。
jest.mock("@/features/dishCategories/hooks/useDishCategorySearch", () => {
	const dishCategories = [
		{ categoryId: "c1", category: "cat", title: "dishCategory", reason: "r", imageUrl: "", isHidden: false },
	];
	// 画面は searchDishCategories(...).then(...) と繋ぐので Promise を返させる
	const resolved = () => Promise.resolve();
	const noop = () => {};
	const value = {
		dishCategories,
		isLoading: false,
		error: null,
		searchDishCategories: resolved,
		refillDishCategories: resolved,
		hideDishCategory: noop,
		unhideDishCategory: noop,
		createDishItemsPromise: noop,
	};
	return { useDishCategorySearch: () => value };
});

import DishCategoriesScreen from "@/app/[locale]/(tabs)/search/dish-categories";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 友達投票ボタンの onPress を取り出す */
function getGroupVotePress(tree: TestRenderer.ReactTestRenderer): () => void {
	const nodes = tree.root.findAllByProps({ testID: "dish-categories-group-vote" });
	const pressable = nodes.find((node) => typeof node.props.onPress === "function");
	expect(pressable).toBeDefined();
	return pressable!.props.onPress as () => void;
}

function findLoggedEvent(eventName: string) {
	return mockLogFrontendEvent.mock.calls.map(([arg]) => arg).find((arg) => arg?.event_name === eventName);
}

describe("#1376 友達投票を開くときの shareToken ガード", () => {
	let tree: TestRenderer.ReactTestRenderer | undefined;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	afterEach(() => {
		if (tree) {
			TestRenderer.act(() => tree!.unmount());
			tree = undefined;
		}
	});

	function render(): TestRenderer.ReactTestRenderer {
		let created: TestRenderer.ReactTestRenderer | undefined;
		TestRenderer.act(() => {
			created = TestRenderer.create(<DishCategoriesScreen />);
		});
		return created!;
	}

	it("shareToken が返ればその値で遷移する（ガードが正常系を止めていないこと）", async () => {
		mockCreateGroupVote.mockResolvedValue({ shareToken: "real-token" });
		tree = render();

		await TestRenderer.act(async () => {
			await getGroupVotePress(tree!)();
		});

		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockRouterPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
				params: expect.objectContaining({ shareToken: "real-token" }),
			}),
		);
		expect(findLoggedEvent("dish_category_group_vote_share_token_missing")).toBeUndefined();
	});

	it.each([
		["undefined", undefined],
		["空文字", ""],
	])("shareToken が %s なら遷移せず、error で記録してスナックバーを出す", async (_label, shareToken) => {
		mockCreateGroupVote.mockResolvedValue({ shareToken });
		tree = render();

		await TestRenderer.act(async () => {
			await getGroupVotePress(tree!)();
		});

		// ここが通ってしまうと URL に `[shareToken]` がリテラルで残り、サーバが 404 を返す
		expect(mockRouterPush).not.toHaveBeenCalled();

		expect(findLoggedEvent("dish_category_group_vote_share_token_missing")).toMatchObject({
			error_level: "error",
			payload: { source: "created" },
		});
		expect(mockShowSnackbar).toHaveBeenCalledWith("DishCategories.errors.fetchFailed");
	});

	it("弾いたあともボタンは押し直せる（ref を解除している）", async () => {
		// #1205 の罠: 遷移しない経路で isOpeningGroupVoteRef を解除し忘れると二度と押せなくなる
		mockCreateGroupVote.mockResolvedValueOnce({ shareToken: undefined });
		tree = render();
		const press = getGroupVotePress(tree);

		await TestRenderer.act(async () => {
			await press();
		});
		expect(mockRouterPush).not.toHaveBeenCalled();

		// 2 回目は正常な token が返る想定。押せなくなっていれば createGroupVote すら呼ばれない
		mockCreateGroupVote.mockResolvedValueOnce({ shareToken: "real-token" });
		await TestRenderer.act(async () => {
			await press();
		});

		expect(mockCreateGroupVote).toHaveBeenCalledTimes(2);
		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockRouterPush).toHaveBeenCalledWith(
			expect.objectContaining({ params: expect.objectContaining({ shareToken: "real-token" }) }),
		);
	});
});
