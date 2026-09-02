/*
#1736 【バグ】**オンボーディングで «許可しない» と答えた直後に、説明の無い OS ダイアログが
もう一度出る。**

Welcome の「はじめる」で検索画面へ戻ると、検索画面は現在地の自動取得を走らせ、その入口
（hooks/useCurrentLocationPosition.ts）が `requestForegroundPermissionsAsync()` を無条件で呼ぶ。
Android は `canAskAgain` が残っている限りダイアログをもう一度出すため、
ユーザーからは「今断ったのに、また聞かれた」に見える。

ここで固定するのは «オンボーディングの答えを見て、自動取得が要求を見送ること»。
周辺依存のスタブ方針は searchScreenPreload.test.tsx と同じ
（検索画面は AuthProvider → lib/supabase → constants/Env まで芋づるに読み込むため、
 断ち切らないと suite ごと落ちる）。
*/
import React from "react";
import TestRenderer from "react-test-renderer";

import {
	__resetOnboardingPermissionOutcomesForTest,
	rememberOnboardingPermissionOutcome,
} from "@/features/onboarding/permissionOutcomes";

// jest.mock のファクトリから参照するため、変数名は `mock` 始まりにする（jest の巻き上げ規則）
const mockRequestAutoCurrentLocation = jest.fn();

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
// 検証したいのは «自動取得を呼ぶか / 呼ばないか» なので、フック自体は呼び出しの記録だけにする
jest.mock("@/features/search/hooks/useAutoCurrentLocation", () => ({
	useAutoCurrentLocation: () => ({ requestAutoCurrentLocation: mockRequestAutoCurrentLocation }),
}));
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({ recentLocations: [], addRecentLocation: jest.fn(), clearRecentLocations: jest.fn() }),
}));
// オンボーディングは «既読»。= 初回導線を終えて検索画面へ戻ってきた直後の状態
jest.mock("@/features/onboarding/hooks/useOnboardingSeen", () => ({ useOnboardingSeen: () => true }));
jest.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/features/search/components/DistanceSlider", () => ({ DistanceSlider: () => null }));
jest.mock("@/features/search/components/PriceLevelsMultiSelect", () => ({ PriceLevelsMultiSelect: () => null }));
jest.mock("@/features/search/components/SelectableGridItem", () => ({ SelectableGridItem: () => null }));
jest.mock("@/features/search/components/SelectableChip", () => ({ SelectableChip: () => null }));

import SearchScreen from "@/app/[locale]/(tabs)/search/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderSearchScreen = () => {
	let tree: TestRenderer.ReactTestRenderer | undefined;
	TestRenderer.act(() => {
		tree = TestRenderer.create(<SearchScreen />);
	});
	return tree!;
};

describe("オンボーディング直後の現在地の自動取得", () => {
	beforeEach(() => {
		__resetOnboardingPermissionOutcomesForTest();
		mockRequestAutoCurrentLocation.mockClear();
	});

	it("オンボーディングで許可されていれば、これまでどおり自動で取得する", () => {
		rememberOnboardingPermissionOutcome("location", "granted");
		const tree = renderSearchScreen();
		expect(mockRequestAutoCurrentLocation).toHaveBeenCalledTimes(1);
		tree.unmount();
	});

	it("オンボーディングが尋ねていない（既存ユーザー等）なら、これまでどおり自動で取得する", () => {
		const tree = renderSearchScreen();
		expect(mockRequestAutoCurrentLocation).toHaveBeenCalledTimes(1);
		tree.unmount();
	});

	it.each(["denied", "unavailable"] as const)("オンボーディングの答えが %s なら、続けて許可を要求しない", (outcome) => {
		rememberOnboardingPermissionOutcome("location", outcome);
		const tree = renderSearchScreen();
		expect(mockRequestAutoCurrentLocation).not.toHaveBeenCalled();
		tree.unmount();
	});
});
