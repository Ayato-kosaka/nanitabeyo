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
/**
 * #1629【43】どのビューから開かれたかは `?view=` で渡る。Calendar から開いた場合を
 * 再現できるよう、ルートパラメータをテストから差し替えられるようにしておく。
 */
let mockSearchParams: Record<string, string> = { locale: "ja-JP" };
jest.mock("expo-router", () => {
	const stub = { push: () => {}, replace: () => {}, back: () => mockBack(), canGoBack: () => true };
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => mockSearchParams,
		useGlobalSearchParams: () => mockSearchParams,
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
		// #1375（10 巡目）`edges` もテストから観測できるよう素通しする
		// （下端インセットの二重取りを見張るため。下の describe を参照）
		SafeAreaView: ({
			children,
			testID,
			edges,
		}: {
			children: React.ReactNode;
			testID?: string;
			edges?: readonly string[];
		}) => ReactActual.createElement(RNView, { testID, edges }, children),
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
	mockSearchParams = { locale: "ja-JP" };
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
	// #1375 実機確認: 軸は折りたたみ（プルダウン）で、選ぶと並びが -featureScore へ寄る
	// #1375 実機確認: 軸は «「条件を選ぶ」を選んだときだけ» 出す。
	// 常に 5 行出していると、日付順で見たいだけの人にも関係ない行が並ぶ
	it("「条件を選ぶ」を押すまで軸は出ない", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		expect(exists(tree, "my-dishes-filter-axis-time-slot")).toBe(false);
		await press(tree, "my-dishes-filter-sort--featureScore");
		expect(exists(tree, "my-dishes-filter-axis-time-slot")).toBe(true);
	});

	it("軸を選ぶと featureKeys に入り、並びが -featureScore へ寄る", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-sort--featureScore");
		// 畳んでいる間は選択肢を描かない（開いて初めて出る）
		expect(exists(tree, "my-dishes-filter-axis-time-slot-morning")).toBe(false);
		await press(tree, "my-dishes-filter-axis-time-slot");
		await press(tree, "my-dishes-filter-axis-time-slot-morning");

		await press(tree, "my-dishes-filter-apply");
		expect(useMyDishesFilterStore.getState().filter.featureKeys).toEqual(["timeSlot:morning"]);
		expect(useMyDishesFilterStore.getState().filter.sort).toBe("-featureScore");
	});

	it("同じ軸の別の値を選ぶと差し替わる（1 軸につき高々 1 件）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-sort--featureScore");
		await press(tree, "my-dishes-filter-axis-time-slot");
		await press(tree, "my-dishes-filter-axis-time-slot-morning");
		// #1375 4 巡目: 値を選ぶとプルダウンは閉じる。別の値にするには開き直す
		expect(exists(tree, "my-dishes-filter-axis-time-slot-lunch")).toBe(false);
		await press(tree, "my-dishes-filter-axis-time-slot");
		await press(tree, "my-dishes-filter-axis-time-slot-lunch");

		await press(tree, "my-dishes-filter-apply");
		expect(useMyDishesFilterStore.getState().filter.featureKeys).toEqual(["timeSlot:lunch"]);
	});

	it("軸を全て外しても sort は巻き戻さない（軸セクションが画面から消えないため）", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-sort--featureScore");
		await press(tree, "my-dishes-filter-axis-scene");
		await press(tree, "my-dishes-filter-axis-scene-date");
		// #1375 4 巡目: 選択でプルダウンが閉じるので、外すには開き直してもう一度押す
		await press(tree, "my-dishes-filter-axis-scene");
		await press(tree, "my-dishes-filter-axis-scene-date");

		// 独立レビュー指摘 #6: ここで -occurredAt へ巻き戻すと、`draft.sort === "-featureScore"`
		// を描画条件にしている軸セクションごと消える。軸ゼロの -featureScore は
		// サーバの resolveSort が既定の並びへ落とすので、そのまま適用してよい
		expect(exists(tree, "my-dishes-filter-axis-scene-date")).toBe(true);

		await press(tree, "my-dishes-filter-apply");
		expect(useMyDishesFilterStore.getState().filter.featureKeys).toEqual([]);
		expect(useMyDishesFilterStore.getState().filter.sort).toBe("-featureScore");
	});

	// #1375 実機確認: 評価は「食べた」を選んだときだけ出す（want 行は評価を持たない）
	it("評価は status が eaten だけのときにしか出さない", async () => {
		const tree = await render(<MyDishesFiltersScreen />);

		expect(exists(tree, "my-dishes-filter-rating-4")).toBe(false);
		await press(tree, "my-dishes-filter-status-eaten");
		expect(exists(tree, "my-dishes-filter-rating-4")).toBe(true);
		await press(tree, "my-dishes-filter-status-want");
		expect(exists(tree, "my-dishes-filter-rating-4")).toBe(false);
	});

	// #1375 実機確認: 期間の絞り込みは廃止した（Calendar → Dish Feed の導線が担当する）
	it("期間の絞り込みは出さない", async () => {
		const tree = await render(<MyDishesFiltersScreen />);
		expect(exists(tree, "my-dishes-filter-period-value")).toBe(false);
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

	/*
	#1375（オーナー指示 7 巡目）**「リセット → 戻る」で戻っていない、への対処。**

	以前は「リセット」が下書きを戻すだけだったので、「適用」を押さずに戻ると
	**何も起きなかった**。「リセット」は取り消しではなく «全部外す» という意思表示なので、
	押した時点で反映する。

	⚠️ ここが落ちたら、また «押したのに何も起きない» に戻っている。
	*/
	it("「リセット」は「適用」を押さなくてもその場で反映される", async () => {
		useMyDishesFilterStore.getState().patch({ status: ["eaten"], minRating: 4, categoryIds: ["ramen"] });
		const tree = await render(<MyDishesFiltersScreen />);

		await press(tree, "my-dishes-filter-reset");

		// 「適用」は押していない
		expect(useMyDishesFilterStore.getState().filter.status).toEqual([]);
		expect(useMyDishesFilterStore.getState().filter.minRating).toBeNull();
		expect(useMyDishesFilterStore.getState().filter.categoryIds).toEqual([]);
	});
});

/*
#1375（10 巡目・オーナー実機指摘「私の iPhone だと謎の余白がある」）
**この画面で下端の安全領域を確保してはいけない。**

絞り込み画面は `(tabs)` の中にあり、下端の安全領域は **タブバーが既に確保している**。
ここで `edges={["bottom"]}` を足すと、ホームインジケータぶん（iPhone で約 34pt）が
タブバーの上へ二重で入り、ボタンの下に説明のつかない帯が出る。

同じ間違いを一度 my-dishes 本体で踏んでおり（`index.tsx` のコメント）、
**この画面だけ直っていなかった**。実機でしか見えない差なので、ここで赤で止める。
*/
describe("#1375 下端の安全領域はタブバーに任せる（二重に取らない）", () => {
	it("SafeAreaView に bottom を渡さない", async () => {
		const tree = await render(<MyDishesFiltersScreen />);
		const safeArea = tree.root.find((node) => node.props?.testID === "my-dishes-filter-screen");
		const edges: readonly string[] = safeArea.props.edges ?? [];
		expect(edges).not.toContain("bottom");
	});
});

/*
#1629【43】オーナー指示「エリアで絞った時に、カレンダーの『絞り込み・並び替え』でエリアの絞り込みを
非表示にする仕様を入れてもらったけど、あれ無くしたい」。

修正前は Calendar から開いたときだけエリアの節を `view !== "calendar"` で丸ごと隠していたので、
下の 2 ケースは «エリアの節が見つからない» で落ちる。
*/
describe("#1629【43】Calendar から開いてもエリアの絞り込みを出す", () => {
	it("view=calendar でもエリアの節（現在値）が出る", async () => {
		mockSearchParams = { locale: "ja-JP", view: "calendar" };
		const tree = await render(<MyDishesFiltersScreen />);

		expect(exists(tree, "my-dishes-filter-area-value")).toBe(true);
	});

	it("view=calendar でも、エリアが確定していれば «解除» から外せる", async () => {
		mockSearchParams = { locale: "ja-JP", view: "calendar" };
		useMyDishesFilterStore.getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });
		const tree = await render(<MyDishesFiltersScreen />);

		expect(exists(tree, "my-dishes-filter-area-clear")).toBe(true);
		await press(tree, "my-dishes-filter-area-clear");
		await press(tree, "my-dishes-filter-apply");

		expect(useMyDishesFilterStore.getState().filter.area).toBeNull();
	});
});
