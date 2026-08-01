/**
 * #1133 保存料理タブの「地点が確定してから検索結果へ飛ぶまで」を守るテスト。
 *
 * ここが本番で実際に走る経路。`useLocationField` 側にも似た形の検証はあるが、
 * viewport の除去・「最近使った場所」への登録・details を取りに行くかどうかの分岐は
 * このファイルの `handleLocationSelect` が自前で持っており（details が解決する頃には
 * モーダル内の `LocationSearchForm` が閉じているため、フック側の関数を呼べない）、
 * フックのテストは**この経路を一切通らない**。
 *
 * 落ちても型では気付けない差分を押さえる:
 * - 確定済みの地点（現在地・最近使った場所）で details API を叩き直さないこと
 * - サジェスト経由で保存するとき viewport を落とすこと（スプレッドに戻すと実行時に残る）
 * - サジェストの details 取得が画面遷移を待たせないこと
 * - entriesKey の location が経路ごとに `pid:` / `ll:` で作り分けられること
 */
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { LocationDetailsResponse } from "@shared/api/v1/res";
import type { SelectedLocation } from "@/features/search/hooks/useLocationField";
import type { DishCategory } from "@/stores/useTopicsStore";

// 検証対象は handleLocationSelect の中身なので、UI とストアは境界でスタブ化する。
// SaveTopicTab / LocationSearchForm は props を捕まえるだけの入れ物に差し替え、
// 「トピックを選ぶ → 地点を確定する」という本番と同じ順序でハンドラを起動する。
const captured: {
	onItemPress?: (item: DishCategory, index: number) => void;
	onSubmit?: (selected: SelectedLocation) => Promise<void> | void;
} = {};

jest.mock("./save/SaveTopicTab", () => ({
	SaveTopicTab: (props: { onItemPress?: (item: DishCategory, index: number) => void }) => {
		captured.onItemPress = props.onItemPress;
		return null;
	},
}));

jest.mock("../components/LocationSearchForm", () => ({
	LocationSearchForm: (props: { onSubmit: (selected: SelectedLocation) => Promise<void> | void }) => {
		captured.onSubmit = props.onSubmit;
		return null;
	},
}));

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
	router: { push: (...args: unknown[]) => mockRouterPush(...args) },
	useLocalSearchParams: () => ({ userId: "user-1" }),
}));

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

const mockGetLocationDetails = jest.fn<Promise<LocationDetailsResponse>, [unknown]>();
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({ getLocationDetails: (...args: [unknown]) => mockGetLocationDetails(...args) }),
}));

const mockCreateDishItemsPromise = jest.fn();
jest.mock("@/features/topics/hooks/useTopicSearch", () => ({
	useTopicSearch: () => ({ createDishItemsPromise: mockCreateDishItemsPromise }),
}));

const mockAddRecentLocation = jest.fn();
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({
		recentLocations: [],
		isLoading: false,
		addRecentLocation: mockAddRecentLocation,
		clearRecentLocations: jest.fn(),
	}),
}));

const mockCloseLocationModal = jest.fn();
jest.mock("@/features/blurModal/hooks/useBlurModal", () => {
	// モーダルの開閉状態は検証対象ではないので、常に中身を描画して onSubmit を取れるようにする
	const BlurModal = ({ children }: { children: React.ReactNode | ((p: { close: () => void }) => React.ReactNode) }) =>
		typeof children === "function" ? children({ close: mockCloseLocationModal }) : children;
	return { useBlurModal: () => ({ BlurModal, open: jest.fn(), close: mockCloseLocationModal }) };
});

const mockUpdateMediaIdsByKeyAsync = jest.fn((_key: string, promise: Promise<string[]>) => promise);
const mockUpsertDishMediaEntries = jest.fn();
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: {
		getState: () => ({
			// 未取得・未ロードの状態にして getIds() を必ず走らせる
			mediaIdsByKey: {},
			isLoadingByKey: {},
			upsertDishMediaEntries: mockUpsertDishMediaEntries,
			updateMediaIdsByKeyAsync: mockUpdateMediaIdsByKeyAsync,
		}),
	},
}));

jest.mock("@/stores/useTopicsStore", () => {
	const useTopicsStore = () => ({
		ids: [],
		isLoading: false,
		error: null,
		hasNextPage: false,
		isLoadingMore: false,
	});
	// 初回マウントの取得は検証対象外なので、取得済みにして走らせない
	useTopicsStore.getState = () => ({
		fetchInitialByKey: jest.fn(),
		hasFetchedInitialByKey: { profileSavedTopics: true },
	});
	return { useTopicsStore, selectTopicIdsByKey: () => () => undefined };
});

import { SavedTopicsTab } from "./SavedTopicsTab";

const topic: DishCategory = {
	id: "cat-1",
	image_url: "https://example.com/ramen.png",
	labels: { "ja-JP": "ラーメン" },
	label_en: "ramen",
} as DishCategory;

/** 「最近使った場所」/ 現在地から来る、緯度経度が確定済みの地点 */
const resolvedShibuya: SelectedLocation = {
	kind: "resolved",
	location: {
		location: { latitude: 35.658, longitude: 139.701 },
		address: "country:JP, locality:Tokyo",
		localLanguageCode: "ja",
	},
	locationQuery: "渋谷駅",
};

/** サジェストから来る、place_id しか判っていない地点 */
const predictionKyoto: SelectedLocation = {
	kind: "prediction",
	prediction: {
		place_id: "place-kyoto",
		text: "京都駅",
		mainText: "京都駅",
		secondaryText: "京都府京都市",
		types: ["train_station"],
	},
	locationQuery: "京都駅",
};

const kyotoDetails: LocationDetailsResponse = {
	location: { latitude: 34.985, longitude: 135.758 },
	viewport: {
		low: { latitude: 34.98, longitude: 135.75 },
		high: { latitude: 34.99, longitude: 135.76 },
	},
	address: "country:JP, locality:Kyoto",
	localLanguageCode: "ja",
};

describe("#1133 SavedTopicsTab の地点確定", () => {
	let renderer: TestRenderer.ReactTestRenderer;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		captured.onItemPress = undefined;
		captured.onSubmit = undefined;
		mockCreateDishItemsPromise.mockResolvedValue([{ dish_media: { id: "media-1" } }]);
		mockGetLocationDetails.mockResolvedValue(kyotoDetails);
	});

	afterEach(async () => {
		await act(async () => {
			renderer?.unmount();
		});
	});

	/** トピックを選んでモーダルを開き、地点確定ハンドラを本番と同じ順序で起動する */
	const selectLocation = async (selected: SelectedLocation) => {
		await act(async () => {
			renderer = TestRenderer.create(<SavedTopicsTab isOwnProfile={true} />);
		});
		await act(async () => {
			captured.onItemPress!(topic, 0);
		});
		await act(async () => {
			await captured.onSubmit!(selected);
		});
		// getIds() は updateMediaIdsByKeyAsync に渡された非同期処理。中身まで検証したいので解決を待つ
		await act(async () => {
			await Promise.all(mockUpdateMediaIdsByKeyAsync.mock.results.map((r) => r.value));
		});
	};

	const pushedEntriesKey = () => mockRouterPush.mock.calls[0][0].params.entriesKey as string;

	it("確定済みの地点（現在地・最近使った場所）では details API を叩き直さない", async () => {
		await selectLocation(resolvedShibuya);

		// 緯度経度は既に手元にある。ここで叩くと課金と待ち時間が増えるだけで得るものが無い
		expect(mockGetLocationDetails).not.toHaveBeenCalled();
		// 保存済みの緯度経度がそのまま検索へ渡ること（詰め替えの取りこぼしを防ぐ）
		expect(mockCreateDishItemsPromise).toHaveBeenCalledWith("cat-1", "ramen", 35.658, 139.701, "ja");
	});

	it("確定済みの地点は「最近使った場所」へ登録し直さない（MRU の更新はフォーム側の責務）", async () => {
		await selectLocation(resolvedShibuya);

		// #1129 の MRU 先頭移動は useLocationField が担う。ここで二重に積むと責務が二重化する
		expect(mockAddRecentLocation).not.toHaveBeenCalled();
	});

	it("確定済みの地点の entriesKey は緯度経度（ll:）で作る", async () => {
		await selectLocation(resolvedShibuya);

		expect(pushedEntriesKey()).toContain("|loc:ll:35.6580,139.7010|");
	});

	it("サジェスト経由は details を取得し、viewport を落として「最近使った場所」へ保存する", async () => {
		await selectLocation(predictionKyoto);

		expect(mockGetLocationDetails).toHaveBeenCalledWith(
			expect.objectContaining({ place_id: "place-kyoto" }) as unknown as never,
		);
		expect(mockAddRecentLocation).toHaveBeenCalledWith({
			location: kyotoDetails.location,
			address: kyotoDetails.address,
			localLanguageCode: kyotoDetails.localLanguageCode,
			locationQuery: "京都駅",
		});
		// スプレッドだけだと型上 Omit していても実行時に viewport が残る。キーの不在を明示的に確かめる
		expect(mockAddRecentLocation.mock.calls[0][0]).not.toHaveProperty("viewport");
		// 保存した地点がそのまま検索にも使われること（viewport 除去で緯度経度を壊していない）
		expect(mockCreateDishItemsPromise).toHaveBeenCalledWith("cat-1", "ramen", 34.985, 135.758, "ja");
	});

	it("サジェスト経由の entriesKey は place_id（pid:）で作る", async () => {
		await selectLocation(predictionKyoto);

		expect(pushedEntriesKey()).toContain("|loc:pid:place-kyoto|");
	});

	it("サジェスト経由でも details の解決を待たずに検索結果へ遷移する", async () => {
		let resolveDetails: (details: LocationDetailsResponse) => void = () => {};
		mockGetLocationDetails.mockReturnValue(
			new Promise<LocationDetailsResponse>((resolve) => {
				resolveDetails = resolve;
			}),
		);

		await act(async () => {
			renderer = TestRenderer.create(<SavedTopicsTab isOwnProfile={true} />);
		});
		await act(async () => {
			captured.onItemPress!(topic, 0);
		});
		await act(async () => {
			await captured.onSubmit!(predictionKyoto);
		});

		// details が未解決のまま遷移していること。await してしまうと、モーダル上に
		// ローディングとエラー処理が無い今は「押しても何も起きない」時間ができる
		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockAddRecentLocation).not.toHaveBeenCalled();

		await act(async () => {
			resolveDetails(kyotoDetails);
			await Promise.all(mockUpdateMediaIdsByKeyAsync.mock.results.map((r) => r.value));
		});
		expect(mockAddRecentLocation).toHaveBeenCalledTimes(1);
	});
});
