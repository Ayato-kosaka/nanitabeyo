// #1129 【設計】「最近使った場所」から選び直したとき、その地点を先頭へ引き上げるテスト。
//
// 背景: useRecentLocations.addRecentLocation は元から「同一地点を除いて先頭へ積む」実装だった
// (= MRU のロジック自体は存在した)。にもかかわらず Issue の現象が起きていたのは、
// **検索画面の handleSelectRecentLocation がそれを呼んでいなかった**ため。
// オートコンプリートからの新規選択(handleLocationSelect)でしか呼ばれておらず、
// リストから選び直しても順序は永遠に固定されたままだった。
//
// この配線は useRecentLocations の単体テストでは絶対に捕まえられない(フック側は正しいので)。
// ここで「再選択 → addRecentLocation が呼ばれる」ことを固定する。
import React from "react";
import TestRenderer from "react-test-renderer";
import type { RecentLocation } from "@/features/search/hooks/useRecentLocations";

// 周辺依存のスタブ方針は searchScreenPreload.test.tsx と同じ(検索画面は AuthProvider →
// lib/supabase → constants/Env まで芋づるに読み込むため、断ち切らないと suite ごと落ちる)
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
// #1196 検索画面は海外未対応の案内(ダイアログ)のため useDialog を使う。Provider 無しで
// レンダリングすると useDialog が throw して suite ごと落ちるため、他の context と同様スタブ化する
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ showDialog: jest.fn(), confirm: jest.fn() }) }));
jest.mock("@/features/search/hooks/useAutoCurrentLocation", () => ({
	useAutoCurrentLocation: () => ({ requestAutoCurrentLocation: jest.fn() }),
}));
// #1486 既読済みにしておく。未読だとオンボーディングへ router.push が走り、
// これらのテストが見たい «検索画面そのもの» の検証にノイズが乗る
jest.mock("@/features/onboarding/hooks/useOnboardingSeen", () => ({
	useOnboardingSeen: () => true,
}));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/features/search/components/DistanceSlider", () => ({ DistanceSlider: () => null }));
jest.mock("@/features/search/components/PriceLevelsMultiSelect", () => ({ PriceLevelsMultiSelect: () => null }));
jest.mock("@/features/search/components/SelectableGridItem", () => ({ SelectableGridItem: () => null }));
jest.mock("@/features/search/components/SelectableChip", () => ({ SelectableChip: () => null }));

// jest.mock のファクトリはホイストされるため、外側の変数を参照できない
// (`mock` プレフィックスの変数だけが例外)。フィクスチャはファクトリ内に直書きする。
const mockAddRecentLocation = jest.fn();
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({
		// Issue の再現状況: 上から「渋谷駅前おおしま皮膚科」「渋谷駅」
		recentLocations: [
			{
				location: { latitude: 35.6591, longitude: 139.7023 },
				address: "country:JP, locality:Tokyo",
				localLanguageCode: "ja",
				locationQuery: "渋谷駅前おおしま皮膚科",
			},
			{
				location: { latitude: 35.658, longitude: 139.7016 },
				address: "country:JP, locality:Tokyo",
				localLanguageCode: "ja",
				locationQuery: "渋谷駅",
			},
		],
		isLoading: false,
		addRecentLocation: mockAddRecentLocation,
		clearRecentLocations: jest.fn(),
	}),
}));

const shibuyaStation: RecentLocation = {
	location: { latitude: 35.658, longitude: 139.7016 },
	address: "country:JP, locality:Tokyo",
	localLanguageCode: "ja",
	locationQuery: "渋谷駅",
};

// 検索画面から LocationAutocomplete へ渡された onSelectRecentLocation を掴み、
// 「リストの1件を押した」状況を直接再現する(コンポーネント内部の表示条件には依存させない)
let onSelectRecentLocation: ((location: RecentLocation) => void) | undefined;
jest.mock("@/components/LocationAutocomplete", () => ({
	LocationAutocomplete: (props: { onSelectRecentLocation?: (location: RecentLocation) => void }) => {
		onSelectRecentLocation = props.onSelectRecentLocation;
		return null;
	},
}));

import SearchScreen from "@/app/[locale]/(tabs)/search/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("#1129 「最近使った場所」からの再選択", () => {
	it("選んだ地点を addRecentLocation へ渡し、MRU 順の先頭へ引き上げる", () => {
		let tree: TestRenderer.ReactTestRenderer | undefined;
		TestRenderer.act(() => {
			tree = TestRenderer.create(<SearchScreen />);
		});

		expect(onSelectRecentLocation).toBeDefined();
		TestRenderer.act(() => {
			// 「渋谷駅前おおしま皮膚科 / 渋谷駅」のうち下段の「渋谷駅」を押す
			onSelectRecentLocation!(shibuyaStation);
		});

		// ここが呼ばれないと順序は永遠に変わらない(= Issue #1129 の現象)
		expect(mockAddRecentLocation).toHaveBeenCalledWith(shibuyaStation);

		TestRenderer.act(() => {
			tree!.unmount();
		});
	});
});
