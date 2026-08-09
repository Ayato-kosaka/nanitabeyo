import { act } from "react";
import TestRenderer from "react-test-renderer";
import { useCandidateDishMediaCache } from "./useCandidateDishMediaCache";

/**
 * #1196 「上流クォータ枯渇のステータスを 500 → 429 に変えても Google Maps フォールバックが発火する」
 * ことを固定する（入口 B: グループ投票の候補から料理メディアを開く導線）。
 *
 * こちらは result.tsx と違って catch から直接ダイアログを出す。
 * bulk-import の失敗ステータスを変えると、この catch に届く ApiError の中身も変わるため、
 * 「ステータスに依らず catch → ダイアログ」であることを押さえておく。
 *
 * ★ ダイアログを出す条件そのものは #1196 では変更していない。
 */

const mockShowGoogleMapsFallbackDialog = jest.fn();
jest.mock("@/features/search/hooks/useGoogleMapsFallback", () => ({
	useGoogleMapsFallback: () => ({
		showGoogleMapsFallbackDialog: mockShowGoogleMapsFallbackDialog,
	}),
}));

const mockCreateDishItemsForCategory = jest.fn();
jest.mock("@/lib/dishMediaSearch", () => ({
	createDishItemsForCategory: (...args: unknown[]) => mockCreateDishItemsForCategory(...args),
}));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja" }) }));

const searchContext = {
	location: { latitude: 35.68944, longitude: 139.69167 },
	localLanguageCode: "ja",
	radius: 500,
	priceLevels: [] as string[],
};

const candidate = {
	id: "candidate-1",
	dishCategoryId: "category-1",
	displayName: "ラーメン",
	dishMediaSearchStatus: "not_searched",
	dishMediaIds: [] as string[],
};

/** useCandidateDishMediaCache をレンダリングして openCandidateDishMedia を取り出す */
const renderOpenCandidate = () => {
	let openCandidateDishMedia!: (candidate: unknown) => Promise<void>;
	const Probe = () => {
		openCandidateDishMedia = useCandidateDishMediaCache({
			cacheCandidateDishMedia: jest.fn(),
			searchContext: searchContext as never,
		}).openCandidateDishMedia as unknown as (candidate: unknown) => Promise<void>;
		return null;
	};
	act(() => {
		TestRenderer.create(<Probe />);
	});
	return openCandidateDishMedia;
};

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("#1196 グループ投票: bulk-import が失敗しても Google Maps フォールバックが出る", () => {
	// 上流クォータ枯渇で bulk-import が 429 を返したときに useAPICall が throw する ApiError
	const quotaApiError = {
		code: "http_error" as const,
		status: 429,
		message: "API call to v1/dishes/bulk-import failed with status 429",
		errorCode: "EXTERNAL_SERVICE_ERROR",
	};

	it.each([
		["429（#1196 で採用した上流クォータ枯渇のステータス）", 429],
		["500（従来のステータス。挙動が変わっていないことの対照）", 500],
	])("%s で失敗してもダイアログが出る", async (_label, status) => {
		mockCreateDishItemsForCategory.mockRejectedValue({ ...quotaApiError, status });
		const openCandidateDishMedia = renderOpenCandidate();

		await act(async () => {
			await openCandidateDishMedia(candidate);
		});

		expect(mockShowGoogleMapsFallbackDialog).toHaveBeenCalledWith(
			expect.objectContaining({ category: "ラーメン", location: searchContext.location }),
		);
	});
});
