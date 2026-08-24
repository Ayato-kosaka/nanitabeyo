/*
#1375 実機確認（5 巡目）バグ「保存スナックバーの『見る』で食べたい/食べたへ行き、
そのあと『探す』へ戻ると条件が全部初期化されている」の回帰テスト。

検索結果は transparentModal で、«見る» は `router.dismissAll()` でモーダルを畳む（#1401）。
そのとき検索画面は作り直され得るため、条件を画面の useState だけに置くと消える。
条件は `useSearchConditionsStore` に置き、画面はそこから初期値を取る — その配線を守る。

⚠️ この store は取得（queryKey）に一切関与しない。ここで検証するのは «画面の初期値» だけである。
*/
import React from "react";
import TestRenderer from "react-test-renderer";

jest.mock("expo-image", () => ({
	Image: function MockExpoImage() {
		return null;
	},
}));
jest.mock(
	"lucide-react-native",
	() =>
		new Proxy(
			{},
			{
				get: (_target, prop) =>
					prop === "__esModule"
						? true
						: function MockIcon() {
								return null;
							},
			},
		),
);
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => {
	const { View: RNView } = require("react-native");
	return { SafeAreaView: RNView };
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: jest.fn() }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getCurrentLocation: () => Promise.resolve(null),
		getLocationDetails: () => Promise.resolve(null),
	}),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ showDialog: jest.fn(), confirm: jest.fn() }) }));

const mockRequestAutoCurrentLocation = jest.fn();
jest.mock("@/features/search/hooks/useAutoCurrentLocation", () => ({
	useAutoCurrentLocation: () => ({ requestAutoCurrentLocation: mockRequestAutoCurrentLocation }),
}));
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({ recentLocations: [], addRecentLocation: jest.fn(), clearRecentLocations: jest.fn() }),
}));
jest.mock("@/features/onboarding/hooks/useOnboardingSeen", () => ({ useOnboardingSeen: () => true }));

// 復元結果を «見える» 形にするための最小スタブ（本物は画像やスライダーを含み、値の観測に向かない）
jest.mock("@/components/LocationAutocomplete", () => {
	const { View: RNView } = require("react-native");
	return {
		LocationAutocomplete: ({ value, testID }: { value: string; testID: string }) => (
			<RNView testID={testID} data-value={value} />
		),
	};
});
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/features/search/components/DistanceSlider", () => {
	const { View: RNView } = require("react-native");
	return { DistanceSlider: ({ distance }: { distance: number }) => <RNView testID="distance" data-value={distance} /> };
});
jest.mock("@/features/search/components/PriceLevelsMultiSelect", () => {
	const { View: RNView } = require("react-native");
	return {
		PriceLevelsMultiSelect: ({ selectedPriceLevels }: { selectedPriceLevels: string[] }) => (
			<RNView testID="price-levels" data-value={selectedPriceLevels.join(",")} />
		),
	};
});
jest.mock("@/features/search/components/SelectableGridItem", () => {
	const { View: RNView } = require("react-native");
	return {
		SelectableGridItem: ({ testID, selected }: { testID: string; selected: boolean }) => (
			<RNView testID={testID} data-selected={selected} />
		),
	};
});
jest.mock("@/features/search/components/SelectableChip", () => {
	const { View: RNView } = require("react-native");
	return {
		SelectableChip: ({ testID, selected }: { testID: string; selected: boolean }) => (
			<RNView testID={testID} data-selected={selected} />
		),
	};
});

import SearchScreen from "@/app/[locale]/(tabs)/search/index";
import { useSearchConditionsStore, type SearchConditions } from "@/features/search/stores/useSearchConditionsStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED: SearchConditions = {
	location: {
		location: { latitude: 35.658, longitude: 139.701 },
		address: "country:JP,region:東京都,locality:渋谷区",
	} as SearchConditions["location"],
	locationQuery: "渋谷",
	timeSlot: "morning",
	timeSlotTouched: true,
	scene: "friends",
	taste: "spicy",
	coreIngredient: undefined,
	diningPace: "leisurely",
	distance: 1200,
	priceLevels: ["PRICE_LEVEL_EXPENSIVE"],
	showAdvancedFilters: true,
};

function render() {
	let tree!: TestRenderer.ReactTestRenderer;
	TestRenderer.act(() => {
		tree = TestRenderer.create(<SearchScreen />);
	});
	return tree;
}

/** testID を持つ «スタブ» 要素の prop を読む（同じ testID の合成要素が複数出るため型で絞る） */
function propOf(tree: TestRenderer.ReactTestRenderer, testID: string, prop: string): unknown {
	const node = tree.root.findAll((n) => n.props?.testID === testID && n.props?.[prop] !== undefined)[0];
	return node?.props?.[prop];
}

describe("#1375 探すタブの検索条件が画面の作り直しで消えない", () => {
	beforeEach(() => {
		useSearchConditionsStore.getState().reset();
		mockRequestAutoCurrentLocation.mockClear();
		jest.useFakeTimers();
		// 20 時 = 端末時間帯による自動設定なら "dinner" になる時刻に固定する。
		// ⚠️ ISO 文字列（オフセット付き）ではなく «実行環境のローカル時刻» で作ること。
		// 画面側は `new Date().getHours()`（ローカル時刻）で判定するため、CI の TZ が
		// Asia/Tokyo でないと +09:00 表記は別の時間帯になる
		jest.setSystemTime(new Date(2026, 7, 23, 20, 0, 0));
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it("保存された条件が無ければ従来どおりの既定値（時間帯は端末時刻から）で始まる", () => {
		const tree = render();
		expect(propOf(tree, "search-time-slot-dinner", "data-selected")).toBe(true);
		expect(propOf(tree, "search-scene-solo", "data-selected")).toBe(true);
		expect(propOf(tree, "search-location-autocomplete", "data-value")).toBe("");
		// 初期表示でも「今の条件」は書き戻る（次の作り直しで復元できる状態にする）
		expect(useSearchConditionsStore.getState().conditions?.timeSlot).toBe("dinner");
	});

	it("保存された条件があれば、地点・時間帯・シーン・詳細条件をすべて復元する", () => {
		useSearchConditionsStore.getState().save(SAVED);
		const tree = render();

		expect(propOf(tree, "search-location-autocomplete", "data-value")).toBe("渋谷");
		// 端末時刻は 20 時（dinner）だが、人が選んだ morning を上書きしないこと
		expect(propOf(tree, "search-time-slot-morning", "data-selected")).toBe(true);
		expect(propOf(tree, "search-time-slot-dinner", "data-selected")).toBe(false);
		expect(propOf(tree, "search-scene-friends", "data-selected")).toBe(true);
		expect(propOf(tree, "search-dining-pace-leisurely", "data-selected")).toBe(true);
		expect(propOf(tree, "price-levels", "data-value")).toBe("PRICE_LEVEL_EXPENSIVE");
		// showAdvancedFilters: true が復元されているので詳細セクションが開いている
		expect(propOf(tree, "distance", "data-value")).toBe(1200);
		expect(propOf(tree, "search-food-style-taste-spicy", "data-selected")).toBe(true);
	});

	it("復元した地点を現在地の自動取得で踏み潰さない", () => {
		useSearchConditionsStore.getState().save(SAVED);
		render();
		expect(mockRequestAutoCurrentLocation).not.toHaveBeenCalled();
	});

	it("保存された地点が無いときは従来どおり現在地を自動取得する", () => {
		useSearchConditionsStore.getState().save({ ...SAVED, location: null, locationQuery: "" });
		render();
		expect(mockRequestAutoCurrentLocation).toHaveBeenCalled();
	});
});

/*
#1375（5 巡目・独立レビュー A-3）「保存されているか」ではなく「人が時間帯を選んだか」で
自動選択を止める。前者だと、初回マウントで既定値を保存した瞬間に成立してしまい、
2 度目以降のマウントで **端末時刻による自動選択が二度と働かなくなる**。
*/
describe("#1375 時間帯の自動選択は «人が選ぶまで» 働き続ける", () => {
	beforeEach(() => {
		useSearchConditionsStore.getState().reset();
		mockRequestAutoCurrentLocation.mockClear();
		jest.useFakeTimers();
		jest.setSystemTime(new Date(2026, 7, 23, 20, 0, 0));
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it("1 度目のマウントで保存されても、2 度目のマウントで自動選択がまた働く", () => {
		// 1 度目: 誰も触っていない。端末時刻（20 時）から dinner になり、その条件が保存される
		render();
		expect(useSearchConditionsStore.getState().conditions?.timeSlot).toBe("dinner");
		expect(useSearchConditionsStore.getState().conditions?.timeSlotTouched).toBe(false);

		// 2 度目: 時計を朝へ進める。人はまだ何も選んでいないので、朝の時間帯が選ばれるべき
		jest.setSystemTime(new Date(2026, 7, 24, 8, 0, 0));
		const tree = render();
		expect(propOf(tree, "search-time-slot-morning", "data-selected")).toBe(true);
	});

	it("人が選んだあとは、時計が変わっても上書きしない", () => {
		useSearchConditionsStore.getState().save({ ...SAVED, timeSlot: "morning", timeSlotTouched: true });
		const tree = render();
		// 端末時刻は 20 時（dinner）だが、人が選んだ morning のまま
		expect(propOf(tree, "search-time-slot-morning", "data-selected")).toBe(true);
		expect(propOf(tree, "search-time-slot-dinner", "data-selected")).toBe(false);
	});
});
