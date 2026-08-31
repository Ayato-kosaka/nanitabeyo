/**
 * #1133 保存料理カテゴリの「地点が確定してから検索結果へ飛ぶまで」を守るテスト。
 *
 * ここが本番で実際に走る経路。`useLocationField` 側にも似た形の検証はあるが、
 * viewport の除去・「最近使った場所」への登録・details を取りに行くかどうかの分岐は
 * このファイルが検証する `handleLocationSelect` が自前で持っており（details が解決する頃には
 * フォームは既に地点を親へ渡し終えているため、フック側の関数を呼べない）、
 * フックのテストは**この経路を一切通らない**。
 *
 * #1369 でモーダルからルートへ移したのに伴い、検証対象も `SavedDishCategoriesTab` から
 * 遷移先の中身（`SavedDishCategoryLocationSearch`）へ移した（ファイル名も合わせて変えている）。
 * 検証している内容は #1133 当時のまま。
 *
 * 落ちても型では気付けない差分を押さえる:
 * - 確定済みの地点（現在地・最近使った場所）で details API を叩き直さないこと
 * - サジェスト経由で保存するとき viewport を落とすこと（スプレッドに戻すと実行時に残る）
 * - サジェストの details 取得が画面遷移を待たせないこと
 * - entriesKey の location が経路ごとに `pid:` / `ll:` で作り分けられること
 * - 遷移が `push` であること（#1369。`replace` にすると「最近使った場所」への登録が消える）
 */
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { LocationDetailsResponse } from "@shared/api/v1/res";
import type { SelectedLocation } from "@/features/search/hooks/useLocationField";

// 検証対象は handleLocationSelect の中身なので、UI とストアは境界でスタブ化する。
// LocationSearchForm は props を捕まえるだけの入れ物に差し替え、本番と同じ入口
//（フォームが地点を確定して親へ渡す）からハンドラを起動する。
const captured: {
	onSubmit?: (selected: SelectedLocation) => Promise<void> | void;
} = {};

jest.mock("../components/LocationSearchForm", () => ({
	LocationSearchForm: (props: { onSubmit: (selected: SelectedLocation) => Promise<void> | void }) => {
		captured.onSubmit = props.onSubmit;
		return null;
	},
}));

const mockRouterPush = jest.fn();
// #1369 replace で遷移すると「最近使った場所」への登録が落ちる（本体のコメント参照）。
// 「push を使っていること」を言うために replace も観測する
const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
	router: {
		push: (...args: unknown[]) => mockRouterPush(...args),
		replace: (...args: unknown[]) => mockRouterReplace(...args),
	},
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
jest.mock("@/features/dishCategories/hooks/useDishCategorySearch", () => ({
	useDishCategorySearch: () => ({ createDishItemsPromise: mockCreateDishItemsPromise }),
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

import { SavedDishCategoryLocationSearch } from "./SavedDishCategoryLocationSearch";

/** ルートのパラメータで運ばれてくる検索対象（保存料理カテゴリ） */
const DISH_CATEGORY_ID = "cat-1";
const DISH_CATEGORY_LABEL_EN = "ramen";

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

describe("#1133 保存料理カテゴリの地点確定（#1369 でルート化）", () => {
	let renderer: TestRenderer.ReactTestRenderer;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		captured.onSubmit = undefined;
		mockCreateDishItemsPromise.mockResolvedValue([{ dish_media: { id: "media-1" } }]);
		mockGetLocationDetails.mockResolvedValue(kyotoDetails);
	});

	afterEach(async () => {
		await act(async () => {
			renderer?.unmount();
		});
	});

	/** 地点検索の画面を開き、地点確定ハンドラを本番と同じ順序で起動する */
	const selectLocation = async (selected: SelectedLocation) => {
		await act(async () => {
			renderer = TestRenderer.create(<SavedDishCategoryLocationSearch dishCategoryId={DISH_CATEGORY_ID} dishCategoryLabelEn={DISH_CATEGORY_LABEL_EN} />);
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
			renderer = TestRenderer.create(<SavedDishCategoryLocationSearch dishCategoryId={DISH_CATEGORY_ID} dishCategoryLabelEn={DISH_CATEGORY_LABEL_EN} />);
		});
		// details が未解決のうちに遷移していることを見たいので、ここでは完了を待たない
		let pending: Promise<void> | void;
		await act(async () => {
			pending = captured.onSubmit!(predictionKyoto);
		});

		// details を await してから遷移すると、この画面にローディングもエラー処理も無い今は
		// 「押しても何も起きない」時間ができる
		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockAddRecentLocation).not.toHaveBeenCalled();

		await act(async () => {
			resolveDetails(kyotoDetails);
			await pending;
			await Promise.all(mockUpdateMediaIdsByKeyAsync.mock.results.map((r) => r.value));
		});
		expect(mockAddRecentLocation).toHaveBeenCalledTimes(1);
	});

	// #1369 ルート化で新しく生まれた不変条件。`replace` にすると details 解決時の
	// `addRecentLocation`（= setRecentLocations の updater の中で AsyncStorage へ書く）が
	// unmount で捨てられ、「サジェストで選んだ地点が履歴に積まれない」という静かな退行になる
	it("検索結果へは push で遷移する（replace にすると最近使った場所の登録が落ちる）", async () => {
		await selectLocation(predictionKyoto);

		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockRouterReplace).not.toHaveBeenCalled();
	});

	// パラメータ無しの URL 直リンク。検索対象が決まらないので、API も遷移も起こさない
	it("トピックのパラメータが無ければ検索も遷移もしない", async () => {
		await act(async () => {
			renderer = TestRenderer.create(<SavedDishCategoryLocationSearch />);
		});
		await act(async () => {
			await captured.onSubmit!(resolvedShibuya);
		});

		expect(mockCreateDishItemsPromise).not.toHaveBeenCalled();
		expect(mockRouterPush).not.toHaveBeenCalled();
	});
});
