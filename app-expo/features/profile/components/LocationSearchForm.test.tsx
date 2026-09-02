/**
 * #1133 保存料理タブの地点検索モーダルが、ホーム（検索タブ）と同じ入口を出していることを守るテスト。
 *
 * 現在地ボタンも「最近使った場所」も `LocationAutocomplete` の機能ではなく、
 * **呼び出し元が props を渡して初めて出る**（`renderInputRight` / `recentLocations`）。
 * つまり props を 1 つ落とすだけで機能が静かに消え、型でも他のテストでも気付けない。
 * ここではその配線が生きていることだけを、実物の `LocationAutocomplete` ごと描画して確かめる。
 */
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { RecentLocation } from "@/components/LocationAutocomplete";

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
// LoadingIndicator はアニメーション実装を持ち込むため差し替える（検証対象ではない）
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
// 翻訳の中身ではなくキーを見たいので、t はキーをそのまま返す
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));

const mockGetCurrentLocation = jest.fn();
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getCurrentLocation: mockGetCurrentLocation,
		suggestions: [],
		status: "idle",
		searchLocations: jest.fn(),
		clearSuggestions: jest.fn(),
	}),
}));

let mockRecentLocations: RecentLocation[] = [];
const mockClearRecentLocations = jest.fn();
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({
		recentLocations: mockRecentLocations,
		isLoading: false,
		addRecentLocation: jest.fn(),
		clearRecentLocations: mockClearRecentLocations,
	}),
}));

import { LocationSearchForm } from "./LocationSearchForm";

const shibuya: RecentLocation = {
	location: { latitude: 35.658, longitude: 139.701 },
	address: "country:JP, locality:Tokyo",
	localLanguageCode: "ja",
	locationQuery: "渋谷駅",
};

const TEST_ID = "saved-dish-category-location-search";

describe("#1133 LocationSearchForm", () => {
	let renderer: TestRenderer.ReactTestRenderer;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockRecentLocations = [];
		mockGetCurrentLocation.mockResolvedValue({
			location: { latitude: 35.68, longitude: 139.76 },
			address: "country:JP, locality:Tokyo",
			localLanguageCode: "ja",
		});
	});

	const mount = async (onSubmit = jest.fn()) => {
		await act(async () => {
			renderer = TestRenderer.create(<LocationSearchForm onSubmit={onSubmit} testID={TEST_ID} />);
		});
		return onSubmit;
	};

	afterEach(async () => {
		await act(async () => {
			renderer?.unmount();
		});
	});

	it("入力欄の右に現在地ボタンを出し、押すと現在地を確定して表示を『現在地』にする", async () => {
		const onSubmit = await mount();

		const button = renderer.root.findByProps({ testID: "saved-dishCategory-current-location-button" });
		expect(button.props.accessibilityLabel).toBe("Search.accessibility.useCurrentLocation");

		await act(async () => {
			await button.props.onPress();
		});

		// place_id を持たない経路なので resolved。呼び出し元は details を取り直さずに済む
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "resolved" }));
		expect(renderer.root.findByProps({ testID: `${TEST_ID}-input` }).props.value).toBe("Search.currentLocation");
	});

	it("未入力でフォーカスしたら、ホームと同じリストの「最近使った場所」を出す", async () => {
		mockRecentLocations = [shibuya];
		const onSubmit = await mount();

		// autofocus は実 TextInput の focus() を呼ぶだけで onFocus は発火しないため、明示的に起こす
		await act(async () => {
			renderer.root.findByProps({ testID: `${TEST_ID}-input` }).props.onFocus();
		});

		const row = renderer.root.findByProps({ testID: `${TEST_ID}-recent-location-0` });
		expect(renderer.root.findByProps({ testID: `${TEST_ID}-recent-locations` })).toBeTruthy();

		await act(async () => {
			row.props.onPress();
		});

		// 保存済みの緯度経度をそのまま復元する(#953)。ここで API を叩くと課金と待ち時間が増える
		expect(mockGetCurrentLocation).not.toHaveBeenCalled();
		expect(onSubmit).toHaveBeenCalledWith({ kind: "resolved", location: shibuya, locationQuery: "渋谷駅" });
	});

	it("最近使った場所が空なら消去ボタンは出さない（押せる対象が無いため）", async () => {
		await mount();

		await act(async () => {
			renderer.root.findByProps({ testID: `${TEST_ID}-input` }).props.onFocus();
		});

		expect(renderer.root.findAllByProps({ testID: `${TEST_ID}-recent-locations-clear` })).toHaveLength(0);
	});
});
