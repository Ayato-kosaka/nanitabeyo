/*
#1396 フィルタ編集は **ルート**（`my-dishes/filters.tsx`）であり、BlurModal ではない（設計書 (2/2) §8-5）。

## portal を持たないこと
`Portal.Host` は `<Stack>` を包んでいる（app/[locale]/_layout.tsx）ので、オーバーレイを
開いたまま push すると遷移先は portal の下に潜って見えず触れない（#1364 で実測）。
`__tests__/mapRestaurantRoute.test.tsx` と同じ形で、react-native-paper の `<Portal>` が
描かれるか否かで固定する。「そもそも import しないこと」は
`scripts/assert-legacy-blur-modal-boundary.mjs` の許可リストが受け持つ。2 つで 1 組。

## チップを押しただけでは store を書かないこと
押すたびに store を書くと、押した回数だけ `queryKey` が変わり、
そのたびに約 964MB の `dish_reviews` へクエリが飛ぶ（#1395 §0(A)）。
**「適用」でだけ書く**ことをここで固定する。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockBack = jest.fn();
jest.mock("expo-router", () => {
	const stub = { push: () => {}, replace: () => {}, back: () => mockBack(), canGoBack: () => true };
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({ locale: "ja-JP" }),
		useGlobalSearchParams: () => ({ locale: "ja-JP" }),
	};
});

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
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

/** `<Portal>` のスタブ。描かれたこと «自体» が検証対象（mapRestaurantRoute.test.tsx と同じ形） */
const mockPortal = jest.fn();
jest.mock("react-native-paper", () => ({
	...jest.requireActual("react-native-paper"),
	Portal: ({ children }: { children?: unknown }) => {
		mockPortal();
		return children ?? null;
	},
}));

import MyDishesFiltersScreen from "../app/[locale]/(tabs)/my-dishes/filters";
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
	const target = tree.root.find((node) => node.props?.testID === testID);
	await act(async () => {
		await target.props.onPress?.();
	});
};

// ⚠️ findAll は composite と host の両方に当たるため «件数» では数えない（同じ testID で 2 件以上出る）。
// 見たいのは「その要素が居るか」と「その要素の props」なので、存在判定と先頭の props で扱う。
const exists = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
	tree.root.findAll((node) => node.props?.testID === testID, { deep: true }).length > 0;

/**
 * 押せるかどうかは «実際に押される要素» の accessibilityState で見る。
 * testID は Chip（composite）にも渡っているので、`accessibilityState` を持つ側を選ぶ。
 */
const accessibilityStateOf = (
	tree: TestRenderer.ReactTestRenderer,
	testID: string,
): { disabled?: boolean; selected?: boolean } =>
	tree.root.findAll((node) => node.props?.testID === testID && !!node.props?.accessibilityState, { deep: true })[0]
		.props.accessibilityState;

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	mockBack.mockClear();
	mockPortal.mockClear();
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1396 my-dishes フィルタ編集ルート", () => {
	it("オーバーレイ（Portal）を 1 つも描かない = BlurModal ではなくルートである", async () => {
		await render(<MyDishesFiltersScreen />);
		expect(mockPortal).not.toHaveBeenCalled();
	});

	it("チップを押しただけでは store を書かない（押すたびに 964MB のテーブルを叩かない）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-status-eaten");

		expect(useMyDishesFilterStore.getState().filter.status).toEqual([]);
	});

	it("「適用」で 1 回だけ store へ反映し、画面を戻す", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-status-eaten");
		await press(tree, "my-dishes-filter-apply");

		expect(useMyDishesFilterStore.getState().filter.status).toEqual(["eaten"]);
		expect(mockBack).toHaveBeenCalledTimes(1);
	});

	it("status に want を含む間は評価チップが押せない（#1395 m-4）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		// 既定は status: [] （= 両方 = want を含む）なので不活性
		expect(accessibilityStateOf(tree, "my-dishes-filter-rating-4").disabled).toBe(true);
		expect(exists(tree, "my-dishes-filter-rating-disabled")).toBe(true);

		await press(tree, "my-dishes-filter-status-eaten");

		expect(accessibilityStateOf(tree, "my-dishes-filter-rating-4").disabled).toBe(false);
		expect(exists(tree, "my-dishes-filter-rating-disabled")).toBe(false);
	});

	it("評価を選んだあとに want を足すと、その評価は落ちる（食べたいが全消しにならない）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-status-eaten");
		await press(tree, "my-dishes-filter-rating-4");
		await press(tree, "my-dishes-filter-status-want");
		await press(tree, "my-dishes-filter-apply");

		expect(useMyDishesFilterStore.getState().filter.minRating).toBeNull();
		expect(useMyDishesFilterStore.getState().filter.status.sort()).toEqual(["eaten", "want"]);
	});

	it("エリア未確定では「近い順」を押せない（lat/lng/radius 欠けの 400 を作らない）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);
		expect(accessibilityStateOf(tree, "my-dishes-filter-sort-distance").disabled).toBe(true);
	});

	// #1396 m-2: エリア解除も「適用」で 1 回だけ反映する（チップと同じ扱いに揃える）
	it("エリア解除は「適用」まで反映しない（この画面からは viewport を触らない）", async () => {
		useMyDishesFilterStore.getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		const tree = await render(<MyDishesFiltersScreen />);

		expect(exists(tree, "my-dishes-filter-area-clear")).toBe(true);
		await press(tree, "my-dishes-filter-area-clear");
		// 「適用」を押すまでは store に反映されない
		expect(useMyDishesFilterStore.getState().filter.area).toEqual({ lat: 35.68, lng: 139.76, radius: 1200 });

		await press(tree, "my-dishes-filter-apply");
		expect(useMyDishesFilterStore.getState().filter.area).toBeNull();
	});

	// #1396 m-3: patch(draft) は area を含まない。エリアは commitArea / clearArea だけが触る
	it("エリアを解除していなければ、適用してもエリアは巻き戻らない（外部の commitArea を上書きしない）", async () => {
		useMyDishesFilterStore.getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		const tree = await render(<MyDishesFiltersScreen />);

		// 画面が開いている間に Map（PR4 の commitArea 相当）でエリアが変わっても…
		await act(async () => {
			useMyDishesFilterStore.getState().commitArea({ lat: 1, lng: 2, radius: 500 });
		});

		await press(tree, "my-dishes-filter-status-eaten");
		await press(tree, "my-dishes-filter-apply");

		// draft のスナップショット（古いエリア）で黙って巻き戻さない
		expect(useMyDishesFilterStore.getState().filter.area).toEqual({ lat: 1, lng: 2, radius: 500 });
	});

	// #1396 確定B: 時間帯・シチュエーションは絞り込みではなく «並び替え» として出す
	it("時間帯・シチュエーションはソート選択肢として出る（絞り込みチップではない）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		expect(exists(tree, "my-dishes-filter-sort--timeSlotScore")).toBe(true);
		expect(exists(tree, "my-dishes-filter-sort--sceneScore")).toBe(true);

		// #1396 m-4: キーを選ぶまで「選択済み」に見せない（同伴キーの既定同伴は廃止）
		await press(tree, "my-dishes-filter-sort--timeSlotScore");
		expect(accessibilityStateOf(tree, "my-dishes-filter-sort--timeSlotScore").selected).toBe(false);
		expect(useMyDishesFilterStore.getState().filter.timeSlotKey).toBeNull();

		await press(tree, "my-dishes-filter-time-slot-morning");
		expect(accessibilityStateOf(tree, "my-dishes-filter-sort--timeSlotScore").selected).toBe(true);

		await press(tree, "my-dishes-filter-apply");
		expect(useMyDishesFilterStore.getState().filter.sort).toBe("-timeSlotScore");
		expect(useMyDishesFilterStore.getState().filter.timeSlotKey).toBe("morning");
	});

	it("キーを選ばずに適用しても同伴キーへ既定値を入れない（m-4）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-sort--sceneScore");
		await press(tree, "my-dishes-filter-apply");

		expect(useMyDishesFilterStore.getState().filter.sceneKey).toBeNull();
	});

	it("「リセット」は確定済みエリアを残す（意図せず全国検索へ戻さない）", async () => {
		useMyDishesFilterStore.getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-status-eaten");
		await press(tree, "my-dishes-filter-reset");
		await press(tree, "my-dishes-filter-apply");

		expect(useMyDishesFilterStore.getState().filter.status).toEqual([]);
		expect(useMyDishesFilterStore.getState().filter.area).toEqual({ lat: 35.68, lng: 139.76, radius: 1200 });
	});
});
