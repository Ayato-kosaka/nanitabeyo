// #1502 【設計】候補選択後、details API(緯度経度の取得)が終わるまで検索場所は未確定である。
//
// 背景: 本番実査(渋谷駅/2026-07-28)で「地名は入っているのに検索ボタンが灰色のまま、理由が
// 分からない」状態が観測された。原因は handleLocationSelect が details 取得の成功後にしか
// `location` を確定させないのに、入力欄はサジェスト選択の瞬間に更新される(=見た目は入力済み)
// ことで、待っている理由が画面に一切出ないことだった。
//
// ここで固定するのは
//   1. 候補選択直後は「確認中」になること
//   2. details が成功すれば「確定」になること。#1673 で入力欄の値は選択時の mainText から
//      **動かさない**ことに戻したので、確定の合図は ✓ アイコンだけであること、
//      最近使った場所へも mainText で保存されること
//   3. details が失敗すれば「失敗」になり、再試行(onRetryConfirmation)でやり直せること
//   4. 確認中に別候補へ選び直したとき、先発の取得が後から返ってきても確定状態を上書きしないこと
//
// 周辺依存のスタブ方針は overseasSearchGuard.test.tsx / recentLocationReselect.test.tsx と同じ
// (検索画面は AuthProvider → lib/supabase → constants/Env まで芋づるに読み込むため、
//  断ち切らないと suite ごと落ちる)
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { AutocompleteLocation, LocationDetailsResponse } from "@shared/api/v1/res";

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
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: jest.fn() }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
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

// jest.mock のファクトリはホイストされるため、外側の変数は `mock` プレフィックスのものしか参照できない
const mockAddRecentLocation = jest.fn();
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({
		recentLocations: [],
		isLoading: false,
		addRecentLocation: mockAddRecentLocation,
		clearRecentLocations: jest.fn(),
	}),
}));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));

// getLocationDetails だけをテストごとに差し替え可能にする(遅延・失敗を制御するため)
const mockGetLocationDetails = jest.fn();
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getCurrentLocation: () => Promise.resolve(null),
		getLocationDetails: (prediction: unknown) => mockGetLocationDetails(prediction),
	}),
}));

// 検索画面から LocationAutocomplete へ渡された props を直接掴む
// (コンポーネント内部の表示条件には依存させない。表示自体は LocationAutocomplete 側の
//  単体テストで別途見る)
let onSelectSuggestion: ((prediction: AutocompleteLocation) => void) | undefined;
let onRetryConfirmation: (() => void) | undefined;
let latestConfirmationStatus: "confirming" | "confirmed" | "error" | null | undefined;
let latestLocationQuery: string | undefined;
jest.mock("@/components/LocationAutocomplete", () => ({
	LocationAutocomplete: (props: {
		value?: string;
		onSelectSuggestion?: (prediction: AutocompleteLocation) => void;
		onRetryConfirmation?: () => void;
		confirmationStatus?: "confirming" | "confirmed" | "error" | null;
	}) => {
		onSelectSuggestion = props.onSelectSuggestion;
		onRetryConfirmation = props.onRetryConfirmation;
		latestConfirmationStatus = props.confirmationStatus;
		latestLocationQuery = props.value;
		return null;
	},
}));

import SearchScreen from "@/app/[locale]/(tabs)/search/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** resolve/reject を外から呼べる Promise を作る(details取得のタイミングを制御するため) */
function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// #1673 【テスト】text は mainText と別の値にしておき、確定しても入力欄が text へ
// 化けないことを区別して検証できるようにする。
// ⚠️ text の並びは実 API に合わせること。Google Autocomplete は languageCode: ja では
// **日本語の住所順**(secondaryText が先・mainText が後)で text を返す。
// #1502 の検証はこれを逆順のモックで撮っていたため、本番でだけ主たる地名が末尾へ回る
// 現象(「日本、東京都渋谷区 渋谷駅」)を最後まで観測できなかった。
const predictionA = {
	place_id: "place-a",
	text: "東京都 地点A",
	mainText: "地点A",
	secondaryText: "東京都",
	types: ["establishment"],
} as unknown as AutocompleteLocation;

const predictionB = {
	place_id: "place-b",
	text: "東京都 地点B",
	mainText: "地点B",
	secondaryText: "東京都",
	types: ["establishment"],
} as unknown as AutocompleteLocation;

function detailsFor(prediction: AutocompleteLocation): LocationDetailsResponse {
	return {
		location: { latitude: 35.0, longitude: 139.0 },
		address: `country:JP, locality:${prediction.place_id}`,
		localLanguageCode: "ja",
		viewport: {
			low: { latitude: 34.9, longitude: 138.9 },
			high: { latitude: 35.1, longitude: 139.1 },
		},
	};
}

describe("#1502 地点確認(confirming/confirmed/error)の状態遷移", () => {
	let tree: TestRenderer.ReactTestRenderer | undefined;

	beforeEach(() => {
		jest.clearAllMocks();
		onSelectSuggestion = undefined;
		onRetryConfirmation = undefined;
		latestConfirmationStatus = undefined;
		latestLocationQuery = undefined;
	});

	afterEach(() => {
		if (tree) {
			act(() => tree!.unmount());
			tree = undefined;
		}
	});

	function renderScreen() {
		act(() => {
			tree = TestRenderer.create(<SearchScreen />);
		});
		expect(onSelectSuggestion).toBeDefined();
	}

	it("候補選択直後は「確認中」になり、details 成功後に「確定」へ遷移しても入力値は mainText のままで、最近使った場所に保存される", async () => {
		const deferred = createDeferred<LocationDetailsResponse>();
		mockGetLocationDetails.mockReturnValueOnce(deferred.promise);
		renderScreen();

		act(() => {
			onSelectSuggestion!(predictionA);
		});
		// details がまだ解決していない間は「確認中」(検索ボタンが灰色のままの理由が画面に出る)。
		// 入力欄はまだ選択した候補の短い表記(mainText)のまま
		expect(latestConfirmationStatus).toBe("confirming");
		expect(latestLocationQuery).toBe("地点A");
		expect(mockAddRecentLocation).not.toHaveBeenCalled();

		await act(async () => {
			deferred.resolve(detailsFor(predictionA));
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(latestConfirmationStatus).toBe("confirmed");
		// #1673 確定しても入力欄は選んだ候補の mainText のまま(text へ置き換えない)
		expect(latestLocationQuery).toBe("地点A");
		expect(latestLocationQuery).not.toBe(predictionA.text);
		// 最近使った場所にも入力欄と同じ mainText で保存される(保存料理タブと同一の表記)
		expect(mockAddRecentLocation).toHaveBeenCalledWith(expect.objectContaining({ locationQuery: "地点A" }));
	});

	it("details が失敗すると「失敗」になり、再試行(onRetryConfirmation)で同じ候補を取り直せる", async () => {
		const failedAttempt = createDeferred<LocationDetailsResponse>();
		mockGetLocationDetails.mockReturnValueOnce(failedAttempt.promise);
		renderScreen();

		act(() => {
			onSelectSuggestion!(predictionA);
		});
		expect(latestConfirmationStatus).toBe("confirming");

		await act(async () => {
			failedAttempt.reject(new Error("network error"));
			await Promise.resolve().catch(() => undefined);
			await Promise.resolve();
		});

		expect(latestConfirmationStatus).toBe("error");
		expect(mockShowSnackbar).toHaveBeenCalledWith("Search.errors.fetchLocation");
		expect(mockAddRecentLocation).not.toHaveBeenCalled();

		// 再試行: 同じ候補で details 取得をやり直す
		const retryAttempt = createDeferred<LocationDetailsResponse>();
		mockGetLocationDetails.mockReturnValueOnce(retryAttempt.promise);
		expect(onRetryConfirmation).toBeDefined();

		act(() => {
			onRetryConfirmation!();
		});
		expect(latestConfirmationStatus).toBe("confirming");
		expect(mockGetLocationDetails).toHaveBeenLastCalledWith(predictionA);

		await act(async () => {
			retryAttempt.resolve(detailsFor(predictionA));
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(latestConfirmationStatus).toBe("confirmed");
	});

	it("確認中に別候補を選び直すと、先発の取得結果が後から返ってきても確定状態を上書きしない", async () => {
		const deferredA = createDeferred<LocationDetailsResponse>();
		const deferredB = createDeferred<LocationDetailsResponse>();
		mockGetLocationDetails.mockReturnValueOnce(deferredA.promise).mockReturnValueOnce(deferredB.promise);
		renderScreen();

		// 地点Aを選ぶ(確認中) → 解決前に地点Bへ選び直す
		act(() => {
			onSelectSuggestion!(predictionA);
		});
		act(() => {
			onSelectSuggestion!(predictionB);
		});
		expect(latestConfirmationStatus).toBe("confirming");
		expect(mockGetLocationDetails).toHaveBeenCalledTimes(2);

		// 先発の A が後から解決しても、まだ B の確認中のままで壊れない
		await act(async () => {
			deferredA.resolve(detailsFor(predictionA));
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(latestConfirmationStatus).toBe("confirming");
		// 入力欄は選び直した B のまま(A の遅延結果で書き換わっていない)。
		// ⚠️ #1673 以降、確定時に入力欄を書き換えないので、この行だけでは競合を検出できない。
		// 競合を実際に捕まえるのは下の addRecentLocation の呼び出し回数・引数の検証である。
		expect(latestLocationQuery).toBe("地点B");
		expect(mockAddRecentLocation).not.toHaveBeenCalled();

		// 後発の B が解決すると確定する
		await act(async () => {
			deferredB.resolve(detailsFor(predictionB));
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(latestConfirmationStatus).toBe("confirmed");
		expect(latestLocationQuery).toBe("地点B");
		// 最近使った場所に保存されるのは B の分だけ(A の遅延結果に上書きされていない)
		expect(mockAddRecentLocation).toHaveBeenCalledTimes(1);
		expect(mockAddRecentLocation).toHaveBeenCalledWith(expect.objectContaining({ locationQuery: "地点B" }));
	});
});
