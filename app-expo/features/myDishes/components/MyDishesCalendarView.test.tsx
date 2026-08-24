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
// #1375 実機確認: 日セルタップは Feed へ push するようになったので、`push` と
// `usePathname`（useLocale が読む）も要る
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
	router: {
		setParams: (...args: unknown[]) => mockSetParams(...args),
		push: (...args: unknown[]) => mockPush(...args),
	},
	usePathname: () => "/ja-JP/my-dishes",
}));

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

// #1446 M-2: Calendar は sort を `-occurredAt` に固定した派生 queryKey で読む（`useMyDishesCalendarQuery`）
const mockUseMyDishesCalendarQuery = jest.fn();
jest.mock("../hooks/useMyDishesCalendarQuery", () => ({
	useMyDishesCalendarQuery: () => mockUseMyDishesCalendarQuery(),
}));

jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { MyDishItem } from "@shared/api/v1/res";
import { MyDishesCalendarView } from "./MyDishesCalendarView";
import { DELETED_MEDIA_TOMBSTONE_TEST_ID } from "@/components/DeletedMediaTombstone";
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
	overrides: {
		thumbnailImageUrl?: string;
		categoryImageUrl?: string | null;
		restaurantImageUrl?: string | null;
		isOwnMediaDeleted?: boolean;
	} = {},
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
		isOwnMediaDeleted: overrides.isOwnMediaDeleted ?? false,
	}) as unknown as MyDishItem;

const mockLoadMore = jest.fn();
const mockRefresh = jest.fn();

const setQueryResult = (overrides: Partial<ReturnType<typeof baseResult>> = {}) => {
	mockUseMyDishesCalendarQuery.mockReturnValue({ ...baseResult(), ...overrides });
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
			items: [makeItem("a", localNoonIso(2026, 8, 1)), makeItem("b", localNoonIso(2026, 7, 5))],
			hasNextPage: false,
			oldestOccurredAt: localNoonIso(2026, 6, 1),
		});
		const tree = await render();

		const ymList = monthsOf(tree).map((m) => m.ym);
		expect(ymList).toEqual(["2026-08", "2026-07"]);
		expect(ymList.some((ym) => ym < "2026-07")).toBe(false);
	});

	// #1446 m-3: 終端の不一致は「消す」ではなく「伸ばす」
	it("終端より古い行が実際にあるときは、その月を切り捨てずに終端を伸ばす", async () => {
		setQueryResult({
			items: [makeItem("a", localNoonIso(2026, 8, 1)), makeItem("old", localNoonIso(2019, 1, 1))],
			hasNextPage: false,
			oldestOccurredAt: localNoonIso(2026, 6, 1),
		});
		const tree = await render();

		const ymList = monthsOf(tree).map((m) => m.ym);
		// 記録が UI から黙って消えない（旧仕様は 2026-06 で切って 2019-01 の行を捨てていた）
		expect(ymList[ymList.length - 1]).toBe("2019-01");
		expect(monthsOf(tree).find((m) => m.ym === "2019-01")?.itemCount).toBe(1);
	});
});

/*
#1446 B-1 / M-1: `onEndReached` は「contentLength が前回発火時と違う」だけで再発火し、
スクロール以外（`_onContentSizeChange` / `_onLayout`）からも判定される。
`isLoadingMore` ガードは**同時実行を 1 本に絞るだけ**で、逐次の連投は止めない。
*/
describe("#1446 B-1 / M-1 指を離したままの自動連投を止める", () => {
	// ⚠️ #1439 B-1 と同じバグ型の 3 回目。初回取得側（useMyDishesQuery の !error）は直っていたが
	// loadMore 側に残っていた。エラー中の再取得の入口はフッタの再試行ボタンだけにする
	it("エラー表示中に onEndReached が来ても loadMore を呼ばない（B-1）", async () => {
		setQueryResult({
			items: [makeItem("a", localNoonIso(2026, 8, 10))],
			hasNextPage: true,
			isLoadingMore: false,
			error: "boom",
		});
		const tree = await render();

		await act(async () => {
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
		});

		expect(mockLoadMore).not.toHaveBeenCalled();

		// 入口は再試行ボタンだけ。押せばちゃんと走る（復帰不能にはしない）
		const retry = findAll(tree, "my-dishes-calendar-load-error-retry");
		await act(async () => {
			retry[0].props.onPress?.();
		});
		expect(mockLoadMore).toHaveBeenCalledTimes(1);
	});

	// M-1 対処 1: フッタの高さを状態に依らず一定にする（スピナー枠を常に確保する）
	it("フッタは状態に依らず常に描かれ、スピナー枠の高さが変わらない（M-1）", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))], hasNextPage: true, isLoadingMore: false });
		const tree = await render();

		const idleFooter = findAllHosts(tree, "my-dishes-calendar-footer");
		expect(idleFooter).toHaveLength(1);
		// ⚠️ rerender すると古いノードは参照できなくなるので、style をここで取り出しておく
		const idleFooterStyle = idleFooter[0].props.style;
		const idleChildCount = idleFooter[0].props.children.length;
		// 読み込み中でなくてもスピナー枠は確保されている（= null を返して高さ 0 にしない）
		expect(findAll(tree, "my-dishes-calendar-loading-more")).toHaveLength(0);

		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))], hasNextPage: true, isLoadingMore: true });
		await rerender(tree);

		const loadingFooter = findAllHosts(tree, "my-dishes-calendar-footer");
		expect(loadingFooter).toHaveLength(1);
		expect(findAll(tree, "my-dishes-calendar-loading-more").length).toBeGreaterThan(0);
		// スピナーの有無で footer の style（= 高さを決める要素）が変わらないこと
		expect(loadingFooter[0].props.style).toEqual(idleFooterStyle);
		// フッタの構造（スピナー枠 / エラー / 終端）の並びも変わらない
		expect(loadingFooter[0].props.children.length).toBe(idleChildCount);
	});

	// M-1 対処 2: 42 件が同一月に収まると月グリッドの高さが増えないため、
	// フッタ高の往復だけで onEndReached が再発火して連投になりうる
	it("直前の loadMore で月が 1 つも増えなかったら、次の onEndReached を無視する（M-1）", async () => {
		const page1 = [makeItem("a", localNoonIso(2026, 8, 10))];
		setQueryResult({ items: page1, hasNextPage: true });
		const tree = await render();
		expect(monthsOf(tree).map((m) => m.ym)).toEqual(["2026-08"]);

		await act(async () => {
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
		});
		expect(mockLoadMore).toHaveBeenCalledTimes(1);

		// 次ページが「同じ月にしか行を足さない」で返る（月数は 1 のまま）
		setQueryResult({ items: [...page1, makeItem("b", localNoonIso(2026, 8, 11))], hasNextPage: true });
		await rerender(tree);
		expect(monthsOf(tree).map((m) => m.ym)).toEqual(["2026-08"]);

		// フッタ高の往復で再発火しても、月が増えていないので握り潰す
		await act(async () => {
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
		});
		expect(mockLoadMore).toHaveBeenCalledTimes(1);
	});

	it("月が増えていれば次の onEndReached はそのまま通る（遡れなくならない）", async () => {
		const page1 = [makeItem("a", localNoonIso(2026, 8, 10))];
		setQueryResult({ items: page1, hasNextPage: true });
		const tree = await render();

		await act(async () => {
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
		});
		expect(mockLoadMore).toHaveBeenCalledTimes(1);

		setQueryResult({ items: [...page1, makeItem("b", localNoonIso(2026, 5, 2))], hasNextPage: true });
		await rerender(tree);
		expect(monthsOf(tree).map((m) => m.ym)).toEqual(["2026-08", "2026-07", "2026-06", "2026-05"]);

		await act(async () => {
			findList(tree).props.onEndReached?.({ distanceFromEnd: 0 });
		});
		expect(mockLoadMore).toHaveBeenCalledTimes(2);
	});
});

/*
#1446 m-1: 日セルを押すと 1 日フィルタ（from / to）が立ち、keep-alive で Calendar は生きたまま。
戻ったときに解除の口が無いと filters 画面を開くまで抜け出せない。
PR4 で Map に入れた「エリアで絞り込み中 + 解除」の帯と同じ形を Calendar にも置く。
*/
/*
#1513 «自分の投稿が削除済み» の日（代表の行が `isOwnMediaDeleted`）。

日付の数字と件数バッジは残す（その日に記録があること自体は変わらない）。
写真の枠だけを墓標へ差し替え、`categoryImageUrl` / `restaurant.image_url` へは落とさない。
*/
describe("#1513 削除済みの日は墓標になる（日付は残す）", () => {
	it("categoryImageUrl があっても画像を出さず、墓標を出す", async () => {
		setQueryResult({
			items: [
				makeItem("a", localNoonIso(2026, 8, 10), {
					categoryImageUrl: "https://example.com/category.jpg",
					restaurantImageUrl: "https://example.com/restaurant.jpg",
					isOwnMediaDeleted: true,
				}),
			],
		});
		const tree = await render();

		expect(findAllHosts(tree, "my-dishes-calendar-day-image").filter((node) => node.props.source)).toHaveLength(0);
		expect(findAllHosts(tree, DELETED_MEDIA_TOMBSTONE_TEST_ID)).toHaveLength(1);
		// 記録がある日として押せるまま（行を消さない）
		expect(findAllHosts(tree, "my-dishes-calendar-day").length).toBeGreaterThan(0);
	});

	it("削除されていない日には墓標を出さない", async () => {
		setQueryResult({
			items: [makeItem("a", localNoonIso(2026, 8, 10), { thumbnailImageUrl: "https://example.com/media.jpg" })],
		});
		const tree = await render();

		expect(findAllHosts(tree, DELETED_MEDIA_TOMBSTONE_TEST_ID)).toHaveLength(0);
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

// #1375 実機確認: 日セルタップは共有フィルタへ期間を書くのをやめ、Dish Feed へ push する。
// 「1 日を見に行ったつもりが、戻っても絞り込みが残っている」状態を作らないためである。
describe("#1375 日セルタップで Dish Feed（date スコープ）へ遷移する", () => {
	it("記録のある日を押すと feed へ push され、共有フィルタは書き換わらない", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))] });
		const tree = await render();

		const day = findAll(tree, "my-dishes-calendar-day").find((node) =>
			String(node.props.accessibilityLabel ?? "").includes("2026-08-10"),
		);
		expect(day).toBeDefined();

		await act(async () => {
			day?.props.onPress?.();
		});

		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/(tabs)/my-dishes/feed",
				params: expect.objectContaining({ scope: "date", date: "2026-08-10" }),
			}),
		);
		// 共有フィルタ（一覧・Map と共有）は触らない
		expect(useMyDishesFilterStore.getState().filter.from).toBeNull();
		expect(useMyDishesFilterStore.getState().filter.to).toBeNull();
		expect(mockSetParams).not.toHaveBeenCalled();
	});

	it("記録の無い日は押せない（遷移しない）", async () => {
		setQueryResult({ items: [makeItem("a", localNoonIso(2026, 8, 10))] });
		const tree = await render();

		const emptyDays = findAll(tree, "my-dishes-calendar-day-empty");
		expect(emptyDays.length).toBeGreaterThan(0);
		const hostEmptyDay = emptyDays.find((node) => node.props.disabled === true);
		expect(hostEmptyDay).toBeDefined();

		await act(async () => {
			emptyDays[0].props.onPress?.();
		});

		expect(mockPush).not.toHaveBeenCalled();
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
