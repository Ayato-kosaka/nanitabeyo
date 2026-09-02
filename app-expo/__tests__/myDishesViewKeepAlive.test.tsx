/*
#1439 レビュー M-1 / M-2 を固定する。

## M-1（Major）ビュー切替でアンマウントしている
`app/[locale]/(tabs)/my-dishes/index.tsx` の条件レンダーは、ルート分割と同じアンマウントを
起こしていた。設計 §2-2 が守ると言った「Map の viewport」「各ビューのスクロール位置」は
守れない。一度訪問したビューはアンマウントせず `display: "none"` 相当で隠すだけにする
（keep-alive）。未訪問のビューはまだマウントしない。

## M-2（Major）既定ビューを list へ
Map の中身は PR4 のスコープなので、既定が `map` のままだと着地時に空の白い領域になる。
list が最も安いビューで、着地時に 964MB の `dish_reviews` への Map クエリを強制しない。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
（`myDishesFiltersRoute.test.tsx` と同じ理由）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

let mockParams: { view?: string } = {};
const mockSetParams = jest.fn((params: { view?: string }) => {
	mockParams = { ...mockParams, ...params };
});
jest.mock("expo-router", () => {
	const stub = {
		push: () => {},
		replace: () => {},
		back: () => {},
		canGoBack: () => true,
		setParams: (p: { view?: string }) => mockSetParams(p),
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => mockParams,
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1", is_anonymous: false } }),
}));
// #1375（5 巡目・性能）画面はタブのフォーカスを見て «見えているビューだけ取得する»。
// このテストはナビゲータの外で画面を描くので、フォーカスは «前面» 固定でよい
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
// #1375（5 巡目）チュートリアルは **必ずスタブ化する**。
// 実体は Modal + 無限ループのアニメーション + 座標の測り直しを持つので、
// マウントすると jest がアイドルにならず OOM で落ちる（実際に落ちた）。
// 料理提案画面のテスト（groupVoteShareTokenGuard.test.tsx）が
// TopicsSpotlightTutorial をスタブ化しているのと同じ理由。
jest.mock("@/features/myDishes/components/MyDishesSpotlightTutorial", () => ({
	MY_DISHES_TUTORIAL_STORAGE_KEY: "my_dishes_spotlight_tutorial_seen_v1",
	MyDishesSpotlightTutorial: () => null,
}));
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

/** list / map ビューが «マウントされた回数» を数えるためのスタブ（keep-alive = 再マウントされない） */
const mockListMount = jest.fn();
jest.mock("@/features/myDishes/components/MyDishesListView", () => {
	const ReactActual = jest.requireActual("react");
	return {
		MyDishesListView: () => {
			ReactActual.useEffect(() => {
				mockListMount();
			}, []);
			return null;
		},
	};
});

const mockMapMount = jest.fn();
jest.mock("@/features/myDishes/components/MyDishesMapView", () => {
	const ReactActual = jest.requireActual("react");
	return {
		MyDishesMapView: () => {
			ReactActual.useEffect(() => {
				mockMapMount();
			}, []);
			return null;
		},
	};
});

const mockCalendarMount = jest.fn();
jest.mock("@/features/myDishes/components/MyDishesCalendarView", () => {
	const ReactActual = jest.requireActual("react");
	return {
		MyDishesCalendarView: () => {
			ReactActual.useEffect(() => {
				mockCalendarMount();
			}, []);
			return null;
		},
	};
});

import MyDishesScreen from "../app/[locale]/(tabs)/my-dishes/index";

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

/** ルートの params が変わったことを模して再レンダーさせる（expo-router は remount しない） */
const rerender = async (tree: TestRenderer.ReactTestRenderer): Promise<void> => {
	await act(async () => {
		tree.update(<MyDishesScreen />);
	});
};

const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID);
	await act(async () => {
		target.props.onPress?.();
	});
};

// ⚠️ findAll は composite と host の両方に当たるため «件数» では数えない
// （myDishesFiltersRoute.test.tsx と同じ注意）。存在判定には length > 0 を使う
const findAll = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.findAll((node) => node.props?.testID === testID, { deep: true });

beforeEach(() => {
	mockParams = {};
	mockSetParams.mockClear();
	mockListMount.mockClear();
	mockMapMount.mockClear();
	mockCalendarMount.mockClear();
});

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

describe("#1439 M-2 既定ビューは list", () => {
	it("view 未指定なら list が既定で表示され、map/calendar はまだマウントされない", async () => {
		const tree = await render(<MyDishesScreen />);

		expect(findAll(tree, "my-dishes-list-view").length).toBeGreaterThan(0);
		expect(findAll(tree, "my-dishes-map-view").length).toBe(0);
		expect(findAll(tree, "my-dishes-calendar-view").length).toBe(0);
		expect(mockListMount).toHaveBeenCalledTimes(1);
	});
});

describe("#1439 M-1 ビュー切替は keep-alive（毎回アンマウントしない）", () => {
	it("一度訪問した list ビューは、他のビューへ切り替えてもアンマウントされない", async () => {
		const tree = await render(<MyDishesScreen />);
		expect(mockListMount).toHaveBeenCalledTimes(1);

		// list -> map
		await press(tree, "my-dishes-view-map");
		await rerender(tree);

		// list は display:none で隠れているだけで、コンポーネントとしては生きている
		// （再マウントされていれば mockListMount が 2 回目を数える）
		expect(mockListMount).toHaveBeenCalledTimes(1);
		expect(findAll(tree, "my-dishes-list-view").length).toBeGreaterThan(0);
		// PR4: map ビューは初訪問でマウントされる。この ref がここで初期化されて初めて
		// §3-2 の「viewport は useRef に置く」が keep-alive の恩恵を受ける
		expect(mockMapMount).toHaveBeenCalledTimes(1);

		// map -> list に戻る
		await press(tree, "my-dishes-view-list");
		await rerender(tree);

		expect(mockListMount).toHaveBeenCalledTimes(1);
		// PR4: list に戻っても map は display:none で隠れているだけ（再マウントされない）。
		// 再マウントされれば MyDishesMapView 内の currentRegionRef が初期化し直され、
		// 「Map の viewport が毎回飛ぶ」（M-1 が防いだはずの挙動）が Map にも再発する
		expect(mockMapMount).toHaveBeenCalledTimes(1);
	});

	it("非表示ビューは pointerEvents と accessibility でタッチ・読み上げから除外される", async () => {
		const tree = await render(<MyDishesScreen />);

		await press(tree, "my-dishes-view-map");
		await rerender(tree);

		const [hiddenListView] = findAll(tree, "my-dishes-list-view");
		expect(hiddenListView.props.pointerEvents).toBe("none");
		expect(hiddenListView.props.accessibilityElementsHidden).toBe(true);
		expect(hiddenListView.props.importantForAccessibility).toBe("no-hide-descendants");

		const [activeMapView] = findAll(tree, "my-dishes-map-view");
		expect(activeMapView.props.pointerEvents).toBe("auto");
		expect(activeMapView.props.accessibilityElementsHidden).toBe(false);
		expect(activeMapView.props.importantForAccessibility).toBe("auto");
	});

	it("直前に見ていたビューは残る（calendar は触るまでマウントしない）", async () => {
		const tree = await render(<MyDishesScreen />);

		await press(tree, "my-dishes-view-map");
		await rerender(tree);
		expect(findAll(tree, "my-dishes-calendar-view").length).toBe(0);

		await press(tree, "my-dishes-view-calendar");
		await rerender(tree);
		expect(findAll(tree, "my-dishes-calendar-view").length).toBeGreaterThan(0);

		// map から離れても、直前に見ていた map ビューは残り続ける（隠れているだけ）
		expect(findAll(tree, "my-dishes-map-view").length).toBeGreaterThan(0);
	});

	/**
	 * #1375（5 巡目・性能レビュー A-2）保持は **MRU 2 つまで**。
	 *
	 * 3 ビューを貼りっぱなしにすると、MapView（ピン数百）と inverted な月リストが
	 * 見えていない間もビュー階層に残り、低メモリ端末のクラッシュ要因になる。
	 * `enabled` で取得を止めてもマウントは残るので、取得の制御だけでは足りない。
	 * 行き来（2 つ）では一度もアンマウントされないことは上の 2 本が固定している。
	 */
	it("3 つ目のビューへ移ると、最も古いビューはアンマウントされる（保持は直近 2 つ）", async () => {
		const tree = await render(<MyDishesScreen />);

		// list（初期） -> map: この時点では list / map の 2 つが生きている
		await press(tree, "my-dishes-view-map");
		await rerender(tree);
		expect(findAll(tree, "my-dishes-list-view").length).toBeGreaterThan(0);

		// -> calendar: 最も古い list が落ちる（map は直前なので残る）
		await press(tree, "my-dishes-view-calendar");
		await rerender(tree);
		expect(findAll(tree, "my-dishes-list-view").length).toBe(0);
		expect(findAll(tree, "my-dishes-map-view").length).toBeGreaterThan(0);

		// list へ戻ると作り直される（= 一度アンマウントされていたことの裏取り）
		await press(tree, "my-dishes-view-list");
		await rerender(tree);
		expect(mockListMount).toHaveBeenCalledTimes(2);
	});

	// PR5: Calendar も同じ器に乗る。再マウントされると inverted リストのスクロール位置
	// （どこまで過去へ遡ったか）が毎回最新月へ戻ってしまう
	it("一度訪問した calendar ビューは、他のビューへ切り替えてもアンマウントされない", async () => {
		const tree = await render(<MyDishesScreen />);
		expect(mockCalendarMount).toHaveBeenCalledTimes(0);

		await press(tree, "my-dishes-view-calendar");
		await rerender(tree);
		expect(mockCalendarMount).toHaveBeenCalledTimes(1);

		// calendar -> list -> calendar と往復しても再マウントされない
		await press(tree, "my-dishes-view-list");
		await rerender(tree);
		expect(mockCalendarMount).toHaveBeenCalledTimes(1);

		await press(tree, "my-dishes-view-calendar");
		await rerender(tree);
		expect(mockCalendarMount).toHaveBeenCalledTimes(1);
	});
});
