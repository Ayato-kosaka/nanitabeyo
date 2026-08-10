import { act } from "react";
import TestRenderer from "react-test-renderer";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";

/**
 * #1196 「上流クォータ枯渇のステータスを 500 → 429 に変えても Google Maps フォールバックが発火する」
 * ことを固定する（入口 A: 検索結果画面）。
 *
 * オーナーから明示的に念を押されている不変条件で、115人/日（実測 92%）が実際に使っている導線。
 *
 * ★ #1243 レビュー Minor-3 でこのファイルを書き直した。
 *   以前は result.tsx の発火条件をテスト側に**書き写して**評価していただけで、result.tsx を
 *   import すらしていなかった。つまり「条件を変えたら赤くなる」と自称しながら、
 *   実際には result.tsx の条件式を書き換えても緑のままだった。
 *   いまは **result.tsx を実際にレンダリングして** useGoogleMapsFallback が呼ばれるかを見ている。
 *   `if (!entriesKey || isLoading || ids.length > 0 || !initialLocation || !category) return;`
 *   のどの項を落としても、下のいずれかのケースが赤くなる。
 *
 * ★ ダイアログを出す条件そのものは #1196 / #1243 のどちらでも変更していない。
 * ★ グループ投票側の入口 B は useCandidateDishMediaCache.fallback.test.tsx、
 *   保存トピック側の入口 C は features/profile/googleMapsFallbackOnQuota.savedTopics.test.tsx が担当する。
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

// 画面本体のロジック（発火条件）だけを見たいので、描画が重い / native 依存の部品は落とす。
jest.mock("@/features/dishMedia/components/DishMediaMap", () => ({ __esModule: true, default: () => null }));
jest.mock("@/features/dishMedia/components/RestaurantLoading", () => ({ RestaurantLoading: () => null }));
jest.mock("@/features/dishMedia/hooks/useDishMediaActions", () => ({
	useDishMediaActions: () => ({ shareRestaurant: jest.fn() }),
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja" }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("expo-linear-gradient", () => {
	const { View } = require("react-native");
	return { LinearGradient: View };
});
jest.mock("lucide-react-native", () => ({ X: () => null, Share2: () => null }));

// ★ import は jest.mock より後に置く（expo-router 等のモックを効かせるため）。
import ResultScreen from "@/app/[locale]/(tabs)/search/result";

/** 上流クォータ枯渇で bulk-import が 429 を返したときに useAPICall が throw する ApiError */
const quotaApiError = {
	code: "http_error" as const,
	status: 429,
	message: "API call to v1/dishes/bulk-import failed with status 429",
	errorCode: "EXTERNAL_SERVICE_ERROR",
};

const location = { latitude: 35.68944, longitude: 139.69167 };

/** ストアを「bulk-import がこの結果で終わった」状態にする */
const settleSearch = async (key: string, result: Promise<string[]>) => {
	await act(async () => {
		await useDishMediaEntriesStore.getState().updateMediaIdsByKeyAsync(key, result, (_prev, next) => next);
	});
};

let renderer: TestRenderer.ReactTestRenderer | null = null;

const renderResultScreen = (params: Record<string, string | undefined>) => {
	mockParams = params;
	act(() => {
		renderer = TestRenderer.create(<ResultScreen />);
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

describe("#1196 検索結果画面: bulk-import が失敗しても Google Maps 退避導線が出る", () => {
	it.each([
		["429（#1196 で採用した上流クォータ枯渇のステータス）", 429],
		["500（従来のステータス。挙動が変わっていないことの対照）", 500],
	])("%s で reject してもダイアログが出る", async (_label, status) => {
		const key = `entries-key-${status}`;
		await settleSearch(key, Promise.reject({ ...quotaApiError, status }));

		renderResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ラーメン" });

		expect(mockShowGoogleMapsFallbackDialog).toHaveBeenCalledWith({
			entriesKey: key,
			category: "ラーメン",
			location,
			locale: "ja",
		});
	});

	it("検索結果 0 件（成功して空配列）でも出る = 失敗と 0 件が同じ導線を通る", async () => {
		const key = "entries-key-empty";
		await settleSearch(key, Promise.resolve([]));

		renderResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ラーメン" });

		expect(mockShowGoogleMapsFallbackDialog).toHaveBeenCalledTimes(1);
	});

	it("ダイアログを出したあと料理候補画面へ戻す（#828 の挙動）", async () => {
		const key = "entries-key-close";
		await settleSearch(key, Promise.resolve([]));

		renderResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ラーメン" });

		expect(mockRouterBack).toHaveBeenCalled();
	});
});

describe("#1196 検索結果画面: 出してはいけない場面で出ない（発火条件の対照）", () => {
	it("1 件でも取得できたら出ない", async () => {
		const key = "entries-key-found";
		await settleSearch(key, Promise.resolve(["dish-media-1"]));

		renderResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ラーメン" });

		expect(mockShowGoogleMapsFallbackDialog).not.toHaveBeenCalled();
	});

	it("ロード中は出ない（0 件がまだ確定していない）", () => {
		const key = "entries-key-loading";
		// 解決しない Promise を渡して isLoading = true のまま描画する
		act(() => {
			void useDishMediaEntriesStore
				.getState()
				.updateMediaIdsByKeyAsync(key, new Promise<string[]>(() => {}), (_prev, next) => next);
		});

		renderResultScreen({ entriesKey: key, location: JSON.stringify(location), category: "ラーメン" });

		expect(mockShowGoogleMapsFallbackDialog).not.toHaveBeenCalled();
	});

	it("category が無いと出ない（Google Maps の検索語が作れない）", async () => {
		const key = "entries-key-no-category";
		await settleSearch(key, Promise.resolve([]));

		renderResultScreen({ entriesKey: key, location: JSON.stringify(location) });

		expect(mockShowGoogleMapsFallbackDialog).not.toHaveBeenCalled();
	});

	it("location が壊れていると出ない（退避先の座標が作れない）", async () => {
		const key = "entries-key-no-location";
		await settleSearch(key, Promise.resolve([]));

		renderResultScreen({ entriesKey: key, location: "not-json", category: "ラーメン" });

		expect(mockShowGoogleMapsFallbackDialog).not.toHaveBeenCalled();
	});
});
