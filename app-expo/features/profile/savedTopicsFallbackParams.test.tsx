import React from "react";
import { act } from "react";
import TestRenderer from "react-test-renderer";
import type { AutocompleteLocation } from "@shared/api/v1/res";

/**
 * #1243 レビュー Major-1: SavedTopicsTab が profile/search-results.tsx へ
 * **緯度経度とカテゴリ名を渡している**ことを固定する。
 *
 * 画面側（features/profile/googleMapsFallbackOnQuota.savedTopics.test.tsx）は
 * 「params が揃っていれば退避導線が出る」ことしか見ていない。
 * params を渡し忘れると画面側は静かに何もしないので、こちらで配線を押さえる。
 *
 * ついでに「getLocationDetails のネットワーク呼び出しは 1 回のまま」も固定する。
 * #1243 では push 前に座標を解決する形へ変えたが、getIds() の中と合わせて 2 回呼ぶと
 * Places Details の課金と呼び出し回数が倍になるため。
 */

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
	router: { push: (...args: unknown[]) => mockRouterPush(...args) },
	useLocalSearchParams: () => ({ userId: "user-1" }),
}));

let mockLocationSearchFormOnSubmit: ((location: AutocompleteLocation) => void) | null = null;
jest.mock("@/features/profile/components/LocationSearchForm", () => ({
	LocationSearchForm: (props: { onSubmit: (location: AutocompleteLocation) => void }) => {
		mockLocationSearchFormOnSubmit = props.onSubmit;
		return null;
	},
}));

jest.mock("@/features/profile/tabs/save/SaveTopicTab", () => ({ SaveTopicTab: () => null }));
jest.mock("@/features/blurModal/hooks/useBlurModal", () => ({
	useBlurModal: () => ({
		BlurModal: ({ children }: { children: (args: { close: () => void }) => React.ReactNode }) =>
			children({ close: jest.fn() }),
		open: jest.fn(),
		close: jest.fn(),
	}),
}));

const mockGetLocationDetails = jest.fn();
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({ getLocationDetails: mockGetLocationDetails }),
}));

const mockCreateDishItemsPromise = jest.fn();
jest.mock("@/features/topics/hooks/useTopicSearch", () => ({
	useTopicSearch: () => ({ createDishItemsPromise: mockCreateDishItemsPromise }),
}));

jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn().mockResolvedValue({ data: [] }) }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja" }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

// ★ import は jest.mock より後に置く。
import { SavedTopicsTab } from "@/features/profile/tabs/SavedTopicsTab";
import { useTopicsStore } from "@/stores/useTopicsStore";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";

const autocompleteLocation: AutocompleteLocation = {
	place_id: "place-1",
	text: "東京駅",
	mainText: "東京駅",
	secondaryText: "東京都千代田区",
	types: ["train_station"],
};

const locationDetails = {
	location: { latitude: 35.68144, longitude: 139.76707 },
	viewport: {
		low: { latitude: 35.6, longitude: 139.7 },
		high: { latitude: 35.7, longitude: 139.8 },
	},
	address: "country:JP, locality:Tokyo",
	localLanguageCode: "ja",
};

const savedTopic = {
	id: "category-1",
	image_url: null,
	labels: { ja: "ラーメン" },
	label_en: "ramen",
};

let renderer: TestRenderer.ReactTestRenderer | null = null;

/** SavedTopicsTab を描画し、トピックを 1 件選んだ状態にして location 選択ハンドラを返す */
const renderAndSelectTopic = async () => {
	await act(async () => {
		renderer = TestRenderer.create(<SavedTopicsTab isOwnProfile={true} />);
	});

	// 保存トピックの一覧はモックしているので、選択状態だけを onItemPress 経由ではなく
	// ストアと props から作れない。代わりに SaveTopicTab の onItemPress を直接呼ぶ。
	const saveTopicTab = renderer!.root.findByProps({ emptyActionLabel: "Profile.buttons.searchByMood" });
	await act(async () => {
		saveTopicTab.props.onItemPress(savedTopic, 0);
	});

	return mockLocationSearchFormOnSubmit!;
};

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	mockLocationSearchFormOnSubmit = null;
	mockGetLocationDetails.mockResolvedValue(locationDetails);
	mockCreateDishItemsPromise.mockResolvedValue([]);
	useTopicsStore.setState({ hasFetchedInitialByKey: { profileSavedTopics: true } });
});

afterEach(() => {
	act(() => {
		renderer?.unmount();
	});
	renderer = null;
	act(() => {
		useDishMediaEntriesStore.getState().clearByKey();
	});
});

describe("#1243 SavedTopicsTab → profile/search-results の受け渡し", () => {
	it("location（緯度経度）と category を params で渡す", async () => {
		const onSubmit = await renderAndSelectTopic();

		await act(async () => {
			await onSubmit(autocompleteLocation);
		});

		expect(mockRouterPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/(tabs)/profile/search-results",
				params: expect.objectContaining({
					location: JSON.stringify(locationDetails.location),
					// bulk-import に渡すのと同じ文字列（表示名 labels[locale] ではない）
					category: "ramen",
				}),
			}),
		);
	});

	it("getLocationDetails は 1 回しか呼ばない（push 前の解決と getIds() で使い回す）", async () => {
		const onSubmit = await renderAndSelectTopic();

		await act(async () => {
			await onSubmit(autocompleteLocation);
		});

		expect(mockGetLocationDetails).toHaveBeenCalledTimes(1);
		expect(mockCreateDishItemsPromise).toHaveBeenCalledWith(
			savedTopic.id,
			savedTopic.label_en,
			locationDetails.location.latitude,
			locationDetails.location.longitude,
			locationDetails.localLanguageCode,
		);
	});

	it("座標を解決できなくても遷移は止めない（#1243 以前と同じ挙動）", async () => {
		mockGetLocationDetails.mockRejectedValue(new Error("details failed"));
		const onSubmit = await renderAndSelectTopic();

		await act(async () => {
			await onSubmit(autocompleteLocation);
		});

		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		// 座標が無いので location は渡らない = 画面側は退避導線を出さない（従来と同じ）
		expect(mockRouterPush.mock.calls[0][0].params.location).toBeUndefined();
	});
});
