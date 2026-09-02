/**
 * #528 候補タップ時にキーボードを閉じる責務が「子（オートコンプリート側）」にあることを守るテスト。
 *
 * 背景（Issue #528）:
 * 以前は親（`BlurModal` の `KeyboardAvoidingView`）が「すべてのタップ**開始**で `Keyboard.dismiss()`」
 * していたため、候補タップが押下成立前に潰れていた。親からその副作用を外した以上、
 * キーボードを閉じるのは候補を押した子自身の仕事になる。
 *
 * ここで固定するのは
 *   1. 候補押下で `onSelectSuggestion` が実際に呼ばれること（選択が成立すること）
 *   2. そのとき `Keyboard.dismiss()` を子が自分で呼ぶこと
 *   3. 呼ぶのはタップ「開始」ではなく `onPress`（＝押下が成立した後）であること
 * 3 は、親の実装で起きていた事故を子側で繰り返さないための歯止め。
 */
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Keyboard } from "react-native";
import type { AutocompleteLocation } from "@shared/api/v1/res";

// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する
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
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));

let mockSuggestions: AutocompleteLocation[] = [];
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		suggestions: mockSuggestions,
		status: "success",
		searchLocations: jest.fn(),
		clearSuggestions: jest.fn(),
	}),
}));

import { LocationAutocomplete, type RecentLocation } from "./LocationAutocomplete";

const TEST_ID = "location-autocomplete";

const shibuya = {
	place_id: "place-shibuya",
	text: "渋谷駅",
	mainText: "渋谷駅",
	secondaryText: "東京都渋谷区",
	types: ["train_station"],
} as unknown as AutocompleteLocation;

const recentShibuya: RecentLocation = {
	location: { latitude: 35.658, longitude: 139.701 },
	address: "country:JP, locality:Tokyo",
	localLanguageCode: "ja",
	locationQuery: "渋谷駅",
};

describe("#528 LocationAutocomplete の候補タップ", () => {
	let renderer: TestRenderer.ReactTestRenderer;
	let dismissSpy: jest.SpyInstance;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockSuggestions = [];
		dismissSpy = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
	});

	afterEach(() => {
		act(() => renderer?.unmount());
		jest.restoreAllMocks();
	});

	/** 値を入れて focus させ、候補パネルが出た状態にする */
	const mountFocused = (props: Partial<React.ComponentProps<typeof LocationAutocomplete>> = {}) => {
		act(() => {
			renderer = TestRenderer.create(
				<LocationAutocomplete
					value="渋谷"
					onChangeText={jest.fn()}
					onSelectSuggestion={jest.fn()}
					testID={TEST_ID}
					{...props}
				/>,
			);
		});
		// autofocus は実 TextInput の focus() を呼ぶだけで onFocus は発火しないため、明示的に起こす
		act(() => renderer.root.findByProps({ testID: `${TEST_ID}-input` }).props.onFocus());
		return renderer;
	};

	it("候補を押すと onSelectSuggestion が呼ばれ、キーボードは子が自分で閉じる", () => {
		mockSuggestions = [shibuya];
		const onSelectSuggestion = jest.fn();
		mountFocused({ onSelectSuggestion });

		const row = renderer.root.findByProps({ testID: `${TEST_ID}-suggestion-0` });
		act(() => row.props.onPress());

		expect(onSelectSuggestion).toHaveBeenCalledWith(shibuya);
		expect(dismissSpy).toHaveBeenCalledTimes(1);
	});

	it("キーボードを閉じるのはタップ開始ではなく onPress（押下成立後）である", () => {
		mockSuggestions = [shibuya];
		mountFocused();

		const row = renderer.root.findByProps({ testID: `${TEST_ID}-suggestion-0` });
		// タップ開始のレスポンダ交渉だけを起こす。ここで閉じると押下が潰れる（#528 の事故）
		act(() => {
			row.props.onStartShouldSetResponder?.({});
		});
		expect(dismissSpy).not.toHaveBeenCalled();

		act(() => row.props.onPress());
		expect(dismissSpy).toHaveBeenCalledTimes(1);
	});

	it("「最近使った場所」を押したときも同じくキーボードを閉じて選択を通す", () => {
		const onSelectRecentLocation = jest.fn();
		mountFocused({ value: "", recentLocations: [recentShibuya], onSelectRecentLocation });

		const row = renderer.root.findByProps({ testID: `${TEST_ID}-recent-location-0` });
		act(() => row.props.onPress());

		expect(onSelectRecentLocation).toHaveBeenCalledWith(recentShibuya);
		expect(dismissSpy).toHaveBeenCalledTimes(1);
	});
});
