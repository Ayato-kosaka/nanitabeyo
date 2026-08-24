/*
#1403 (PR2) my-dishes の意思決定の計測を «画面の側» から固定する。

payload の中身そのものは `features/myDishes/analytics.test.ts` が、入口と出口の突き合わせは
`features/myDishes/markAsEatenFunnel.test.ts` が受け持つ。ここで見るのは **いつ出るか** だけである。

## 1. レンダーごとに出さない（ログの爆発を止める）

my-dishes のフィルタは「チップを押すたびに store を書かない」作りになっている
（押した回数だけ約 964MB の `dish_reviews` を叩くため。#1395 §0(A)）。
**計測も同じ境界に合わせる**: チップ押下では 1 行も出さず、「適用」でだけ 1 回出す。
ここが緩むと、1 回の絞り込みがログでは 10 行にも 20 行にもなり、
「どの絞り込みが使われたか」を数えた瞬間に «押した回数» で歪む。

ビュー切替も同じで、**同じビューを押し直しても出さない**。

## 2. 保存 → 食べた の «出口» が共有ルートで誤爆しない

`review-from-media` は my-dishes 以外からも入ってくる共有ルートである。
my-dishes から押していないときは完了イベントを 1 行も出さないことを固定する。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
（`__tests__/myDishesFiltersRoute.test.tsx` と同じ理由）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();
const mockDismissTo = jest.fn();
jest.mock("expo-router", () => {
	const stub = {
		push: (...args: unknown[]) => mockPush(...args),
		replace: () => {},
		back: () => mockBack(),
		setParams: (...args: unknown[]) => mockSetParams(...args),
		dismissTo: (...args: unknown[]) => mockDismissTo(...args),
		canGoBack: () => true,
		canDismiss: () => true,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({ locale: "ja-JP", restaurantId: "rest-1", dishMediaId: "media-1" }),
		useGlobalSearchParams: () => ({ locale: "ja-JP" }),
		usePathname: () => "/ja-JP/my-dishes",
		useFocusEffect: () => {},
		useNavigation: () => ({ addListener: () => () => {} }),
	};
});

/** 全画面で共有する 1 つの spy。画面ごとに新しい jest.fn() を返すと «出た回数» を数えられない */
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

// ⚠️ フックのモックは «毎レンダー新しい関数» を返してはいけない。
// `review-from-media` の取得 effect は `[restaurantId, dishMediaId, callBackend, showSnackbar,
// logFrontendEvent]` を依存に持つので、`callBackend` の identity が毎回変わると
// effect → setState → 再レンダー → effect … が止まらず、jest ごとヒープを食い潰す
// （実際に踏んで OOM した）。返す値は必ずモジュールスコープで固定すること。
// （`jest.mock` の factory は巻き上げられるので、返す値は factory の «中» で 1 度だけ作る。
// 外の const を参照すると out-of-scope variable として弾かれる）
// #1375（5 巡目・性能）画面はタブのフォーカスを見て «見えているビューだけ取得する»。
// ナビゲータの外で画面を描くテストなので、フォーカスは «前面» 固定でよい
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => {
	const value = { lightImpact: jest.fn(), mediumImpact: jest.fn() };
	return { useHaptics: () => value };
});
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/hooks/useAPICall", () => {
	const value = { callBackend: jest.fn() };
	return { useAPICall: () => value };
});
jest.mock("@/contexts/SnackbarProvider", () => {
	const value = { showSnackbar: jest.fn() };
	return { useSnackbar: () => value };
});
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
jest.mock("@/lib/authGuest", () => ({ isGuestUser: () => false }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("react-native-safe-area-context", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
		useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
		SafeAreaView: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
			ReactActual.createElement(RNView, { testID }, children),
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
jest.mock("@/components/ScreenHeader", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return { ScreenHeader: () => ReactActual.createElement(RNView, null) };
});
jest.mock("@/components/LoadingIndicator", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return { LoadingIndicator: () => ReactActual.createElement(RNView, null) };
});

// 3 ビューの中身は計測と無関係（Map / FlatList / TrueSheet を持ち込むと本題がぼやける）
jest.mock("@/features/myDishes/components/MyDishesListView", () => ({ MyDishesListView: () => null }));
jest.mock("@/features/myDishes/components/MyDishesMapView", () => ({ MyDishesMapView: () => null }));
jest.mock("@/features/myDishes/components/MyDishesCalendarView", () => ({ MyDishesCalendarView: () => null }));

// `review-from-media` は «成功コールバックが呼ばれたとき» の挙動だけが見たいので、
// フォーム本体は押すと onSuccess を呼ぶだけの箱に差し替える
jest.mock("@/features/map/components/ReviewForm", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		ReviewForm: ({ onSuccess }: { onSuccess: (r: { dishReviewId: string }) => void }) =>
			ReactActual.createElement(RNView, {
				testID: "review-form",
				onPress: () => onSuccess({ dishReviewId: "review-1" }),
			}),
	};
});

// 取得を走らせないため、両ストアともキャッシュ命中の形で返す（画面はそのまま描画へ進む）
jest.mock("@/stores/useRestaurantStore", () => {
	const entry = { restaurant: { id: "rest-1", name: "テスト店" }, meta: {} };
	const state = { getById: () => entry, upsert: jest.fn() };
	return { useRestaurantStore: { getState: () => state } };
});
jest.mock("@/stores/useDishMediaEntriesStore", () => {
	const entry = { dish_media: { id: "media-1" }, dish: { id: "dish-1" } };
	const state = { upsertDishMediaEntries: jest.fn() };
	return {
		useDishMediaEntriesStore: { getState: () => state },
		selectEntryByMediaId: () => () => entry,
	};
});

import MyDishesScreen from "../app/[locale]/(tabs)/my-dishes/index";
import MyDishesFiltersScreen from "../app/[locale]/(tabs)/my-dishes/filters";
import ReviewFromMediaScreen from "../app/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]";
import { MY_DISHES_EVENTS } from "../features/myDishes/analytics";
import { beginMarkAsEaten, clearMarkAsEatenIntent } from "../features/myDishes/markAsEatenFunnel";
import { useMyDishesFilterStore } from "../features/myDishes/stores/useMyDishesFilterStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	mountedTrees.push(tree);
	return tree;
};

const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID && typeof node.props?.onPress === "function");
	await act(async () => {
		await target.props.onPress?.();
	});
};

/** 指定イベントだけを取り出す。他イベント（screen_view など）に件数を汚されないため */
const eventsNamed = (name: string) =>
	mockLogFrontendEvent.mock.calls.map(([arg]) => arg).filter((arg) => arg?.event_name === name);

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	clearMarkAsEatenIntent();
	mockLogFrontendEvent.mockClear();
	mockPush.mockClear();
	mockSetParams.mockClear();
	mockDismissTo.mockClear();
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1403 フィルタの計測は «適用したときだけ» 1 回出る", () => {
	it("チップを押しただけでは 1 行も出さない", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-status-eaten");
		await press(tree, "my-dishes-filter-status-want");
		await press(tree, "my-dishes-filter-sort--rating");

		expect(eventsNamed(MY_DISHES_EVENTS.filterApplied)).toHaveLength(0);
	});

	it("「適用」で 1 回だけ出る（何回チップを押していても 1 回）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-status-eaten");
		await press(tree, "my-dishes-filter-rating-4");
		await press(tree, "my-dishes-filter-rating-3");
		await press(tree, "my-dishes-filter-apply");

		const applied = eventsNamed(MY_DISHES_EVENTS.filterApplied);
		expect(applied).toHaveLength(1);
		expect(applied[0].error_level).toBe("log");
		expect(applied[0].payload).toMatchObject({ status: "eaten", minRating: 3 });
	});

	it("再レンダーだけでは出ない（適用後に外から store が動いても増えない）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);
		await press(tree, "my-dishes-filter-apply");
		expect(eventsNamed(MY_DISHES_EVENTS.filterApplied)).toHaveLength(1);

		await act(async () => {
			useMyDishesFilterStore.getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		});

		expect(eventsNamed(MY_DISHES_EVENTS.filterApplied)).toHaveLength(1);
	});
});

describe("#1403 ビュー切替の計測は «実際に変わったときだけ» 出る", () => {
	it("別のビューを押すと from → to で 1 回出る", async () => {
		const tree = await render(<MyDishesScreen />);

		await press(tree, "my-dishes-view-map");

		const selected = eventsNamed(MY_DISHES_EVENTS.viewSelected);
		expect(selected).toHaveLength(1);
		expect(selected[0]).toMatchObject({ error_level: "log", payload: { from: "list", to: "map" } });
	});

	// 押すたびに出す形にすると、連打しただけで «ビューを何度も行き来した» ように見える
	it("同じビューを押し直しても出さない", async () => {
		const tree = await render(<MyDishesScreen />);

		await press(tree, "my-dishes-view-list");
		await press(tree, "my-dishes-view-list");

		expect(eventsNamed(MY_DISHES_EVENTS.viewSelected)).toHaveLength(0);
		expect(mockSetParams).not.toHaveBeenCalled();
	});
});

describe("#1403 保存 → 食べた の完了", () => {
	it("my-dishes から押していれば、記録完了で 1 回だけ出る", async () => {
		beginMarkAsEaten({
			from: "list",
			itemKey: "item-1",
			restaurantId: "rest-1",
			dishMediaId: "media-1",
			startedAt: Date.now(),
		});
		const tree = await render(<ReviewFromMediaScreen />);

		await press(tree, "review-form");

		const completed = eventsNamed(MY_DISHES_EVENTS.markAsEatenCompleted);
		expect(completed).toHaveLength(1);
		expect(completed[0].error_level).toBe("log");
		expect(completed[0].payload).toMatchObject({
			from: "list",
			itemKey: "item-1",
			restaurantId: "rest-1",
			dishMediaId: "media-1",
			dishReviewId: "review-1",
		});
		expect(completed[0].payload.durationMs).toBeGreaterThanOrEqual(0);
	});

	// このルートはフィード・店舗詳細からも入ってくる。無条件に出すと
	// my-dishes を開いてすらいない投稿まで「保存→食べた の完了」に数えてしまう
	it("my-dishes 以外から来た記録では 1 行も出さない", async () => {
		const tree = await render(<ReviewFromMediaScreen />);

		await press(tree, "review-form");

		expect(eventsNamed(MY_DISHES_EVENTS.markAsEatenCompleted)).toHaveLength(0);
		// 計測が出なくても、記録そのものの後処理（キャッシュ破棄と遷移）は従来どおり走る
		expect(mockDismissTo).toHaveBeenCalledTimes(1);
	});
});
