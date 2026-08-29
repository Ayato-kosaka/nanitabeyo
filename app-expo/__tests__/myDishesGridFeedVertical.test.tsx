/*
#1629 【回帰】**グリッド（一覧）から開くフィードは «上下だけ»。N 番目を開いて縦に払うと N+1 番目。**

オーナー指摘:
> グリッドからのフィードで横スクロールできるのは何故でしたっけ？お店でグルーピングしてるなら要らない。
> グリッドは上下だけ。同じ店 / 同じ日とかはマップとかカレンダーの話。

修正前は、一覧が **店舗 id を重複排除して**縦の並びに置いていた。その結果

- 外側の縦ページャ = 重複排除後の «店舗»
- 内側の横 = その店の複数の記録

となり、**グリッドに同じ店が 3 セル並んでいても縦のページは 1 枚に潰れ、残り 2 件が横軸へ回る**。
グリッドで見えているセルの数と、縦に送れる数が一致していなかった。

このテストは一覧の `onPress` から Feed 画面の描画までを **通しで**見る。
片方だけを見るテスト（`MyDishesListView.test.tsx` / `myDishesFeedRoute.test.tsx`）では、
«一覧が置いた並び» と «Feed が読む並び» の食い違いを検出できないからである。

⚠️ ここが赤くなったら、グリッドのセルと縦のページがまたずれている。
*/
jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	default: {
		t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
	},
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
	router: {
		push: (...args: unknown[]) => mockPush(...args),
		back: jest.fn(),
		replace: jest.fn(),
		canDismiss: () => true,
	},
	useLocalSearchParams: () => mockParams,
}));

jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return { Image: ({ source }: { source?: { uri?: string } }) => ReactActual.createElement(RNView, { source }) };
});

// 一覧の見た目はこのテストの関心ではない。data をそのまま renderItem へ流す薄いフェイク
jest.mock("@/components/collapsible-tabs/GridList", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		GridList: ({ data, renderItem }: { data: { id: string }[]; renderItem: (info: { item: unknown }) => unknown }) =>
			ReactActual.createElement(
				RNView,
				{ testID: "my-dishes-list" },
				data.map((item: { id: string }) => ReactActual.createElement(RNView, { key: item.id }, renderItem({ item }))),
			),
	};
});

// `DishMediaFeed` は 1 行も変えない。受け取った props を覗けるスタブに差し替える
jest.mock("@/features/dishMedia/components/DishMediaFeed", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: (props: { entriesKey: string; horizontal?: boolean }) =>
			ReactActual.createElement(RNView, { testID: "dish-media-feed", ...props }),
	};
});

const mockUseMyDishesQuery = jest.fn();
jest.mock("@/features/myDishes/hooks/useMyDishesQuery", () => ({
	useMyDishesQuery: () => mockUseMyDishesQuery(),
}));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { MyDishItem } from "@shared/api/v1/res";

import MyDishesFeedScreen from "../app/[locale]/(tabs)/my-dishes/feed";
import { MyDishesListView } from "../features/myDishes/components/MyDishesListView";
import { myDishesFeedKey } from "../features/myDishes/constants";
import { useMyDishesFeedScopeStore } from "../features/myDishes/stores/useMyDishesFeedScopeStore";
import { useDishMediaEntriesStore } from "../stores/useDishMediaEntriesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE_HEIGHT = 780;

/**
 * グリッドの並び（この順で縦に送れなければならない）。
 * **1 番目と 2 番目は同じ店**。ここが今のバグの本体で、以前は縦 1 ページへ潰れていた。
 */
const GRID: { key: string; restaurantId: string; mediaId: string | null }[] = [
	{ key: "review:a", restaurantId: "r-1", mediaId: "media-a" },
	{ key: "review:b", restaurantId: "r-1", mediaId: "media-b" },
	{ key: "review:c", restaurantId: "r-2", mediaId: "media-c" },
	{ key: "review:d", restaurantId: "r-1", mediaId: "media-d" },
	// 写真なしの行は Feed に入れられないので、縦の並びからも外れる
	{ key: "review:no-photo", restaurantId: "r-3", mediaId: null },
];

/** 写真がある行だけ（= 縦のページになる行）を、グリッドの順のまま */
const PHOTO_ROWS = GRID.filter((row) => row.mediaId !== null);

const makeRow = (row: (typeof GRID)[number]): MyDishItem =>
	({
		key: row.key,
		status: "eaten",
		occurredAt: "2026-08-10T12:00:00.000Z",
		savedAt: null,
		eatenAt: "2026-08-10T12:00:00.000Z",
		restaurant: { id: row.restaurantId, name: "テスト食堂", image_url: "https://example.com/r.jpg" },
		dish: { id: "dish-1", name: "ラーメン", categoryImageUrl: null },
		dishMedia:
			row.mediaId === null
				? null
				: { id: row.mediaId, thumbnailImageUrl: "https://example.com/m.jpg", render_type: "stored" },
		myReview: null,
		isOwnMediaDeleted: false,
	}) as unknown as MyDishItem;

const makeEntry = (mediaId: string) => ({
	restaurant: { id: "r-1", name: "テスト食堂" },
	dish: { id: "dish-1", category_id: "ramen", name: "ラーメン" },
	dish_media: {
		id: mediaId,
		isMine: false,
		isSaved: false,
		isEaten: true,
		isLiked: false,
		likeCount: 0,
		mediaUrl: null,
		thumbnailImageUrl: "",
	},
	dish_reviews: [],
});

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

/** 一覧を描いて N 番目のセルを押し、`router.push` に渡ったパラメータを返す */
const openGridCell = async (index: number): Promise<Record<string, string>> => {
	mockUseMyDishesQuery.mockReturnValue({
		items: GRID.map(makeRow),
		isLoading: false,
		isLoadingMore: false,
		error: null,
		hasNextPage: false,
		loadMore: jest.fn(),
		refresh: jest.fn(),
	});
	let list!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		list = TestRenderer.create(<MyDishesListView />);
	});
	const cells = list.root.findAll(
		(node) => node.props?.testID === "my-dishes-list-item" && typeof node.props?.onPress === "function",
	);
	expect(cells).toHaveLength(GRID.length);
	await act(async () => {
		cells[index].props.onPress();
	});
	// 一覧はここで用済み。並びは store に置かれている（＝画面を離れても残る）
	await act(async () => {
		list.unmount();
	});
	expect(mockPush).toHaveBeenCalledTimes(1);
	return mockPush.mock.calls[0][0].params as Record<string, string>;
};

/** 一覧が push したパラメータで Feed 画面を開く */
const openFeed = async (params: Record<string, string>): Promise<TestRenderer.ReactTestRenderer> => {
	mockParams = params;
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<MyDishesFeedScreen />);
	});
	// ページャは onLayout で実寸法が確定するまで描かない（ウィンドウ寸法で計算すると黒画面）
	await act(async () => {
		const containers = tree.root.findAll((node) => typeof node.props?.onLayout === "function");
		containers[0]?.props.onLayout({ nativeEvent: { layout: { width: 390, height: PAGE_HEIGHT } } });
	});
	await act(async () => {});
	mountedTrees.push(tree);
	return tree;
};

const pagerOf = (tree: TestRenderer.ReactTestRenderer) =>
	tree.root.find((node) => node.props?.testID === "my-dishes-feed-pager");

/** 縦に 1 ページぶん払う（ページャは `onMomentumScrollEnd` で前面のページを決める） */
const flickTo = async (tree: TestRenderer.ReactTestRenderer, index: number) => {
	const pager = pagerOf(tree);
	await act(async () => {
		pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0, y: PAGE_HEIGHT * index } } });
	});
	await act(async () => {});
};

/**
 * ページャが index 番目のページへ渡す props（＝実際に描くときと同じもの）。
 *
 * ⚠️ マウント済みのノードを探して回らないこと。`FlatList` は `windowSize` のぶんしか
 * マウントせず、react-test-renderer には実レイアウトが無いので、払った先のページが
 * «まだマウントされていない» のか «並びが間違っている» のか区別が付かない。
 * 見たいのは **ページャの取り決め**（どの index にどの scope を、どれを前面として描くか）
 * なので、`renderItem` をそのまま呼んで確かめる。
 */
const pagePropsAt = (tree: TestRenderer.ReactTestRenderer, index: number) => {
	const pager = pagerOf(tree);
	const page = pager.props.renderItem({ item: pager.props.data[index], index });
	return page.props.children.props as { scope: unknown; isActive: boolean };
};

beforeEach(() => {
	mockPush.mockClear();
	mockParams = {};
	useMyDishesFeedScopeStore.getState().clear();
	useDishMediaEntriesStore.getState().clearByKey();
	mockCallBackend.mockReset();
	mockCallBackend.mockImplementation(async (path: string, options: { requestPayload?: { ids?: string[] } }) => {
		if (path === "v1/dish-media") return { items: (options.requestPayload?.ids ?? []).map(makeEntry) };
		// #1629 item スコープは «行の取得» を 1 回も挟まない。ここへ来たら設計が崩れている
		throw new Error(`unexpected path: ${path}`);
	});
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1629 グリッドから開くフィードは «縦だけ»", () => {
	it("縦のページは «グリッドに出ている順の 1 セル 1 ページ»（同じ店でも潰さない）", async () => {
		const tree = await openFeed(await openGridCell(0));

		const pager = pagerOf(tree);
		expect(pager.props.data.map((scope: { itemKey: string }) => scope.itemKey)).toEqual(
			PHOTO_ROWS.map((row) => row.key),
		);
		// r-1 が 3 行あっても 3 ページ。以前はここが 2（= 重複排除後の店舗数）だった
		expect(pager.props.data).toHaveLength(4);
		// 外側は縦（FlatList の horizontal 未指定 = 縦）
		expect(pager.props.horizontal).toBe(false);
	});

	it("ページャの key が衝突しない（同じ店の行が複数あっても一意）", async () => {
		const tree = await openFeed(await openGridCell(0));

		const pager = pagerOf(tree);
		const keys = pager.props.data.map((scope: unknown, index: number) => pager.props.keyExtractor(scope, index));
		expect(new Set(keys).size).toBe(keys.length);
	});

	it.each([
		[0, "review:a", "review:b"],
		// 同じ店の 2 件目を開く（バグの本体）。次は «別の店» ではなく «グリッドの次のセル»
		[1, "review:b", "review:c"],
		[2, "review:c", "review:d"],
	])("グリッドの %i 番目を開くとそこから始まり、縦に 1 回払うと次のセルが出る", async (index, opened, next) => {
		const tree = await openFeed(await openGridCell(index));

		// 開いた位置 = グリッドで押したセル
		expect(pagerOf(tree).props.initialScrollIndex).toBe(index);
		expect(pagePropsAt(tree, index)).toMatchObject({
			isActive: true,
			scope: { kind: "item", itemKey: opened, dishMediaId: PHOTO_ROWS[index].mediaId },
		});

		// 縦に 1 回払う → 次のページはグリッドの次のセル
		await flickTo(tree, index + 1);

		expect(pagePropsAt(tree, index + 1)).toMatchObject({
			isActive: true,
			scope: { kind: "item", itemKey: next, dishMediaId: PHOTO_ROWS[index + 1].mediaId },
		});
		expect(pagePropsAt(tree, index).isActive).toBe(false);
	});

	it("写真なしの行は縦の並びに入らない（Feed に入れられない）", async () => {
		const tree = await openFeed(await openGridCell(0));

		expect(pagerOf(tree).props.data.map((scope: { itemKey: string }) => scope.itemKey)).not.toContain(
			"review:no-photo",
		);
	});

	it("1 ページの中身は 1 件だけ（＝横に送れる先が無い）", async () => {
		const tree = await openFeed(await openGridCell(1));

		const key = myDishesFeedKey("item:review:b");
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[key]).toEqual(["media-b"]);
		const feeds = tree.root.findAll((node) => node.props?.testID === "dish-media-feed");
		expect(feeds.length).toBeGreaterThan(0);
		expect(feeds.map((node) => node.props.entriesKey)).toContain(key);
	});

	it("行の取得（GET /v1/users/me/dishes）を 1 回も挟まない", async () => {
		await openFeed(await openGridCell(1));

		expect(mockCallBackend.mock.calls.every(([path]) => path === "v1/dish-media")).toBe(true);
		expect(mockCallBackend.mock.calls.length).toBeGreaterThan(0);
	});

	/*
	web の直リンク・リロードでは store が空になる（persist していない）。
	そのときは URL が持っている 1 件へ縮退する。「見つかりません」にしてはいけない。
	*/
	it("並びが無い（直リンク・リロード）ときは、その 1 件へ縮退する", async () => {
		const params = await openGridCell(2);
		useMyDishesFeedScopeStore.getState().clear();

		const tree = await openFeed(params);

		expect(pagerOf(tree).props.data).toEqual([{ kind: "item", itemKey: "review:c", dishMediaId: "media-c" }]);
	});
});
