import { act } from "react";
import TestRenderer from "react-test-renderer";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";

/**
 * #1243 レビュー Major-1: 保存トピック経由（入口 C）にも Google Maps 退避導線があることを固定する。
 *
 * bulk-import（POST v1/dishes/bulk-import）を叩く経路は 3 つあるが、
 * この経路（features/profile/tabs/SavedTopicsTab.tsx → app/[locale]/(tabs)/profile/search-results.tsx）
 * **だけ退避導線が無く**、上流クォータ枯渇時にユーザーが本当に行き止まりになっていた。
 * #1196 で 429 / HttpException を warn へ落としたぶん、ここが壊れても error には出ない。
 * だから「壊れていない」ことをテストで押さえる。
 *
 * 条件は app/[locale]/(tabs)/search/result.tsx の写しなので、
 * 入口 A のテスト（features/search/googleMapsFallbackOnQuota.test.tsx）と同じケースを並べている。
 * 片方だけ直すと差分が見えるように、意図的に同じ構成にしてある。
 */

const mockShowGoogleMapsFallbackDialog = jest.fn();
jest.mock("@/features/search/hooks/useGoogleMapsFallback", () => ({
	useGoogleMapsFallback: () => ({
		showGoogleMapsFallbackDialog: mockShowGoogleMapsFallbackDialog,
	}),
}));

const mockRouterBack = jest.fn();
let mockParams: Record<string, string | undefined> = {};
jest.mock("expo-router", () => ({
	router: {
		back: (...args: unknown[]) => mockRouterBack(...args),
		push: jest.fn(),
	},
	useLocalSearchParams: () => mockParams,
}));

jest.mock("@/features/dishMedia/components/DishMediaMap", () => ({ __esModule: true, default: () => null }));
jest.mock("@/features/dishMedia/components/RestaurantLoading", () => ({ RestaurantLoading: () => null }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja" }) }));
jest.mock("expo-linear-gradient", () => {
	const { View } = require("react-native");
	return { LinearGradient: View };
});
jest.mock("lucide-react-native", () => ({ X: () => null }));

// ★ import は jest.mock より後に置く（expo-router 等のモックを効かせるため）。
import ProfileSearchResultScreen from "@/app/[locale]/(tabs)/profile/search-results";

/** 上流クォータ枯渇で bulk-import が 429 を返したときに useAPICall が throw する ApiError */
const quotaApiError = {
	code: "http_error" as const,
	status: 429,
	message: "API call to v1/dishes/bulk-import failed with status 429",
	errorCode: "EXTERNAL_SERVICE_ERROR",
};

const location = { latitude: 35.68944, longitude: 139.69167 };

const settleSearch = async (key: string, result: Promise<string[]>) => {
	await act(async () => {
		await useDishMediaEntriesStore.getState().updateMediaIdsByKeyAsync(key, result, (_prev, next) => next);
	});
};

let renderer: TestRenderer.ReactTestRenderer | null = null;

const renderProfileSearchResultScreen = (params: Record<string, string | undefined>) => {
	mockParams = params;
	act(() => {
		renderer = TestRenderer.create(<ProfileSearchResultScreen />);
	});
};

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	mockParams = {};
});

afterEach(() => {
	// マウントしたまま store を触ると、テスト終了後に再レンダーが走って落ちる。必ず先に unmount する。
	act(() => {
		renderer?.unmount();
	});
	renderer = null;
	act(() => {
		useDishMediaEntriesStore.getState().clearByKey();
	});
});

describe("#1243 保存トピックの検索結果画面: bulk-import が失敗しても Google Maps 退避導線が出る", () => {
	it.each([
		["429（#1196 で採用した上流クォータ枯渇のステータス）", 429],
		["500（従来のステータス。挙動が変わっていないことの対照）", 500],
	])("%s で reject してもダイアログが出る", async (_label, status) => {
		const key = `profile-entries-key-${status}`;
		await settleSearch(key, Promise.reject({ ...quotaApiError, status }));

		renderProfileSearchResultScreen({
			entriesKey: key,
			location: JSON.stringify(location),
			category: "ramen",
		});

		expect(mockShowGoogleMapsFallbackDialog).toHaveBeenCalledWith({
			entriesKey: key,
			category: "ramen",
			location,
			locale: "ja",
		});
	});

	it("検索結果 0 件（成功して空配列）でも出る", async () => {
		const key = "profile-entries-key-empty";
		await settleSearch(key, Promise.resolve([]));

		renderProfileSearchResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ramen" });

		expect(mockShowGoogleMapsFallbackDialog).toHaveBeenCalledTimes(1);
	});

	it("ダイアログを出したあと保存トピック一覧へ戻す", async () => {
		const key = "profile-entries-key-close";
		await settleSearch(key, Promise.resolve([]));

		renderProfileSearchResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ramen" });

		expect(mockRouterBack).toHaveBeenCalled();
	});
});

describe("#1243 保存トピックの検索結果画面: 出してはいけない場面で出ない（発火条件の対照）", () => {
	it("1 件でも取得できたら出ない", async () => {
		const key = "profile-entries-key-found";
		await settleSearch(key, Promise.resolve(["dish-media-1"]));

		renderProfileSearchResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ramen" });

		expect(mockShowGoogleMapsFallbackDialog).not.toHaveBeenCalled();
	});

	it("ロード中は出ない（0 件がまだ確定していない）", () => {
		const key = "profile-entries-key-loading";
		act(() => {
			void useDishMediaEntriesStore
				.getState()
				.updateMediaIdsByKeyAsync(key, new Promise<string[]>(() => {}), (_prev, next) => next);
		});

		renderProfileSearchResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ramen" });

		expect(mockShowGoogleMapsFallbackDialog).not.toHaveBeenCalled();
	});

	it("category が無いと出ない（Google Maps の検索語が作れない）", async () => {
		const key = "profile-entries-key-no-category";
		await settleSearch(key, Promise.resolve([]));

		renderProfileSearchResultScreen({ entriesKey: key, location: JSON.stringify(location) });

		expect(mockShowGoogleMapsFallbackDialog).not.toHaveBeenCalled();
	});

	it("location が壊れていると出ない（退避先の座標が作れない）", async () => {
		const key = "profile-entries-key-no-location";
		await settleSearch(key, Promise.resolve([]));

		renderProfileSearchResultScreen({ entriesKey: key, location: "not-json", category: "ramen" });

		expect(mockShowGoogleMapsFallbackDialog).not.toHaveBeenCalled();
	});
});
