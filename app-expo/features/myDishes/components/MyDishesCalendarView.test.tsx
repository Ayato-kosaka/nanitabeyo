/*
#1396 PR5 Calendar ビューの中核テスト（設計書 (2/2) §4）。

固定するのは 4 点：
1. **`inverted` で上方向（過去）へ遡れること**。`onEndReached` は inverted なので
   「視覚的な上端」で発火し、より古い月がリスト末尾（= 視覚的な上）へ足される
2. **`meta.oldestOccurredAt` より古い月を生成しない**（終端で止まる）
3. `dishMedia === null` でも灰色プレースホルダーにせず `dish.categoryImageUrl` を使う
   （#1375 追補2 決定3）
4. 日セルタップで期間（`from` / `to`）を確定し、リストビューへ切り替える（§4-5）

エラー時の「失敗を伝える出口」（PR #1442 M-1 の再発防止）は、`hasFetchedInitial` に
関係なくエラー + 再試行が出ることをここで、**再試行押下で実際に取得が走ること**を
`MyDishesCalendarView.retry.test.tsx`（フックをモックしない）で固定する。
*/
jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	// params を潰さないモック。日セルの accessibilityLabel から日付を引くために必要
	default: {
		t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
	},
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));

const mockSetParams = jest.fn();
jest.mock("expo-router", () => ({ router: { setParams: (...args: unknown[]) => mockSetParams(...args) } }));

jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Image: ({ source }: { source?: { uri?: string } }) =>
			ReactActual.createElement(RNView, { testID: "my-dishes-calendar-day-image", source }),
	};
});

jest.mock("@/components/PrimaryButton", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		PrimaryButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
			ReactActual.createElement(RNView, { testID, onPress }),
	};
});

const mockUseMyDishesQuery = jest.fn();
jest.mock("../hooks/useMyDishesQuery", () => ({
	useMyDishesQuery: () => mockUseMyDishesQuery(),
}));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { MyDishItem } from "@shared/api/v1/res";
import { MyDishesCalendarView } from "./MyDishesCalendarView";
import type { CalendarMonth } from "../calendar";
import { useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** ローカルの `y-m-d 12:00`。どの TZ で走らせても同じローカル日付に落ちる */
const localNoonIso = (year: number, month: number, day: number): string =>
	new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();

const NOW = new Date(2026, 7, 20, 10, 0, 0);

const makeItem = (
	key: string,
	occurredAt: string,
	overrides: { thumbnailImageUrl?: string; categoryImageUrl?: string | null; restaurantImageUrl?: string | null } = {},
): MyDishItem =>
	({
		key,
		status: "eaten",
		occurredAt,
		savedAt: null,
		eatenAt: occurredAt,
		restaurant: { id: "restaurant-1", name: "テスト食堂", image_url: overrides.restaurantImageUrl ?? null },
		dish: { id: "dish-1", name: "ラーメン", categoryImageUrl: overrides.categoryImageUrl ?? null },
		dishMedia: overrides.thumbnailImageUrl ? { id: "media-1", thumbnailImageUrl: overrides.thumbnailImageUrl } : null,
		myReview: null,
	}) as unknown as MyDishItem;

const mockLoadMore = jest.fn();
const mockRefresh = jest.fn();

const setQueryResult = (overrides: Partial<ReturnType<typeof baseResult>> = {}) => {
	mockUseMyDishesQuery.mockReturnValue({ ...baseResult(), ...overrides });
};

const baseResult = () => ({
	items: [] as MyDishItem[],
	queryKey: "default",
	isLoading: false,
	isLoadingMore: false,
	error: null as string | null,
	hasFetchedInitial: true,
	hasNextPage: false,
	oldestOccurredAt: null as string | null,
	loadMore: mockLoadMore,
	refresh: mockRefresh,
});

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async () => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<MyDishesCalendarView />);
	});
	mountedTrees.push(tree);
	return tree;
};

const rerender = async (tree: TestRenderer.ReactTestRenderer) => {
	await act(async () => {
		tree.update(<MyDishesCalendarView />);
	});
};

/** FlatList 本体（`data` / `inverted` / `onEndReached` を持つノード） */
const findList = (tree: TestRenderer.ReactTestRenderer) =>
	tree.root.find((node) => node.props?.testID === "my-dishes-calendar-list" && node.props?.data !== undefined);

const monthsOf = (tree: TestRenderer.ReactTestRenderer): CalendarMonth[] =>
	findList(tree).props.data as CalendarMonth[];

const findAll = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.findAll((node) => node.props?.testID === testID, { deep: true });

// ⚠️ findAll は composite（自作コンポーネント）と host（View など）の両方に当たるため、
// «件数» を数えるときはホストノードだけに絞る（myDishesFiltersRoute.test.tsx と同じ注意）
const findAllHosts = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	findAll(tree, testID).filter((node) => typeof node.type === "string");

beforeAll(() => {
	jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
	jest.setSystemTime(NOW);
});

afterAll(() => {
	jest.useRealTimers();
});

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	mockLoadMore.mockClear();
	mockRefresh.mockClear();
	mockSetParams.mockClear();
	setQueryResult();
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1396 §4-2 inverted FlatList で上方向（過去）へ遡る", () => {
	it("FlatList は inverted で、data[0] が最新月（= 画面下端）になる", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 6, 10))] });
		const tree = await render();

		const list = findList(tree);
		// ★ inverted こそが「native と web の両方で上方向スクロールを成立させる」唯一の手（§4-2）
		expect(list.props.inverted).toBe(true);
		expect(list.props.onEndReachedThreshold).toBe(0.5);

		const months = monthsOf(tree);
		expect(months[0].ym).toBe("2026-08");
		expect(months[months.length - 1].ym).toBe("2026-06");
	});

	it("onEndReached（inverted では視覚的な上端）でさらに過去のページを読み、古い月が追加される", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))], hasNextPage: true });
		const tree = await render();

		expect(monthsOf(tree).map((m) => m.ym)).toEqual(["2026-08"]);

		await act(async () => {
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
		});
		expect(mockLoadMore).toHaveBeenCalledTimes(1);

		// 次ページが届いた状態（store 経由で items が伸びる）を模す
		setQueryResult({
			items: [makeItem("a", localNoonIso(2026, 8, 10)), makeItem("b", localNoonIso(2026, 5, 2))],
			hasNextPage: true,
		});
		await rerender(tree);

		// 古い月がリスト末尾（= 視覚的な上）へ足される。0 件の月も繋げて描く
		expect(monthsOf(tree).map((m) => m.ym)).toEqual(["2026-08", "2026-07", "2026-06", "2026-05"]);
	});

	it("追加取得中は onEndReached が連投されても 1 本しか投げない（42 件が同一月に収まっても暴走しない）", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))], hasNextPage: true, isLoadingMore: true });
		const tree = await render();

		await act(async () => {
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
		});

		expect(mockLoadMore).not.toHaveBeenCalled();
		expect(findAll(tree, "my-dishes-calendar-loading-more").length).toBeGreaterThan(0);
	});
});

describe("#1396 §4-4 meta.oldestOccurredAt より古い月を生成しない（終端で止まる）", () => {
	it("終端（nextCursor === null）では onEndReached を何度叩いても取得しない", async () => {
		setQueryResult({
			items: [makeItem("a", localNoonIso(2026, 7, 10))],
			hasNextPage: false,
			oldestOccurredAt: localNoonIso(2026, 7, 1),
		});
		const tree = await render();

		await act(async () => {
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
		});

		expect(mockLoadMore).not.toHaveBeenCalled();
		expect(findAll(tree, "my-dishes-calendar-reached-oldest").length).toBeGreaterThan(0);
	});

	it("oldestOccurredAt より古い月は 1 つも作らない（上へ無限に伸びない）", async () => {
		setQueryResult({
			// 終端より古い行が混ざっていても、終端より古い月は生成しない
			items: [makeItem("a", localNoonIso(2026, 8, 1)), makeItem("old", localNoonIso(2019, 1, 1))],
			hasNextPage: false,
			oldestOccurredAt: localNoonIso(2026, 6, 1),
		});
		const tree = await render();

		const ymList = monthsOf(tree).map((m) => m.ym);
		expect(ymList).toEqual(["2026-08", "2026-07", "2026-06"]);
		expect(ymList.some((ym) => ym < "2026-06")).toBe(false);
	});
});

describe("#1375 追補2 決定3 日セルのサムネイル", () => {
	it("dishMedia === null なら dish.categoryImageUrl の実画像を使う（灰色プレースホルダーにしない）", async () => {
		setQueryResult({
			items: [
				makeItem("a", localNoonIso(2026, 8, 10), {
					categoryImageUrl: "https://example.com/category.jpg",
					restaurantImageUrl: "https://example.com/restaurant.jpg",
				}),
			],
		});
		const tree = await render();

		const images = findAllHosts(tree, "my-dishes-calendar-day-image").filter((node) => node.props.source);
		expect(images).toHaveLength(1);
		expect(images[0].props.source.uri).toBe("https://example.com/category.jpg");
	});

	it("dishMedia があればそのサムネイルを優先する", async () => {
		setQueryResult({
			items: [
				makeItem("a", localNoonIso(2026, 8, 10), {
					thumbnailImageUrl: "https://example.com/media.jpg",
					categoryImageUrl: "https://example.com/category.jpg",
				}),
			],
		});
		const tree = await render();

		const images = findAllHosts(tree, "my-dishes-calendar-day-image").filter((node) => node.props.source);
		expect(images[0].props.source.uri).toBe("https://example.com/media.jpg");
	});

	it("同じ日に 2 件以上あれば件数バッジを出す", async () => {
		setQueryResult({
			items: [makeItem("a", localNoonIso(2026, 8, 10)), makeItem("b", localNoonIso(2026, 8, 10))],
		});
		const tree = await render();

		const days = findAllHosts(tree, "my-dishes-calendar-day").filter((node) => node.props.accessibilityLabel);
		expect(days).toHaveLength(1);
		expect(days[0].props.accessibilityLabel).toContain('"count":2');
	});
});

describe("#1396 §4-5 日セルタップで期間（from / to）を確定する", () => {
	it("記録のある日を押すと from/to がその日に確定し、リストビューへ切り替わる", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))] });
		const tree = await render();

		const day = findAll(tree, "my-dishes-calendar-day").find((node) =>
			String(node.props.accessibilityLabel ?? "").includes("2026-08-10"),
		);
		expect(day).toBeDefined();

		await act(async () => {
			day?.props.onPress?.();
		});

		const { filter } = useMyDishesFilterStore.getState();
		expect(filter.from).toBe(new Date(2026, 7, 10, 0, 0, 0, 0).toISOString());
		expect(filter.to).toBe(new Date(2026, 7, 10, 23, 59, 59, 999).toISOString());
		// 3 ビューがフィルタ状態を共有していることのデモ（§4-5）
		expect(mockSetParams).toHaveBeenCalledWith({ view: "list" });
	});

	it("記録の無い日は押せない（空の結果に切り替わらない）", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))] });
		const tree = await render();

		const emptyDays = findAll(tree, "my-dishes-calendar-day-empty");
		expect(emptyDays.length).toBeGreaterThan(0);
		const hostEmptyDay = emptyDays.find((node) => node.props.disabled === true);
		expect(hostEmptyDay).toBeDefined();

		await act(async () => {
			emptyDays[0].props.onPress?.();
		});

		expect(useMyDishesFilterStore.getState().filter.from).toBeNull();
		expect(mockSetParams).not.toHaveBeenCalled();
	});
});

describe("#1442 M-1 の再発防止：失敗をユーザーに伝え、手動リトライの出口を出す", () => {
	it("hasFetchedInitial が false のままでも、error があればエラー + 再試行が出る", async () => {
		// 取得失敗の最終状態: hasFetchedInitial=false / isLoading=false / error だけが立つ
		setQueryResult({ items: [], hasFetchedInitial: false, isLoading: false, error: "boom" });
		const tree = await render();

		expect(findAll(tree, "my-dishes-calendar-empty").length).toBeGreaterThan(0);
		const retry = findAll(tree, "my-dishes-calendar-empty-retry");
		expect(retry.length).toBeGreaterThan(0);

		await act(async () => {
			retry[0].props.onPress?.();
		});
		expect(mockRefresh).toHaveBeenCalledTimes(1);
	});

	it("読み込み済みの月がある状態で追加取得に失敗したら、月を消さずに再試行の口を出す", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))], hasNextPage: true, error: "boom" });
		const tree = await render();

		// 既に読めている月は消さない（消すとユーザーは何も見えなくなる）
		expect(monthsOf(tree).map((m) => m.ym)).toEqual(["2026-08"]);

		const retry = findAll(tree, "my-dishes-calendar-load-error-retry");
		expect(retry.length).toBeGreaterThan(0);
		await act(async () => {
			retry[0].props.onPress?.();
		});
		expect(mockLoadMore).toHaveBeenCalledTimes(1);
	});

	it("0 件かつエラー無しのときだけ空状態を出す（エラーと空を混同しない）", async () => {
		setQueryResult({ items: [], hasFetchedInitial: true, error: null });
		const tree = await render();

		expect(findAll(tree, "my-dishes-calendar-empty").length).toBeGreaterThan(0);
		expect(findAll(tree, "my-dishes-calendar-empty-retry").length).toBe(0);
	});
});
