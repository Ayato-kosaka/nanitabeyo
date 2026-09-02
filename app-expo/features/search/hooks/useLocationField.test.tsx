import { act } from "react";
import TestRenderer from "react-test-renderer";
import type { LocationDetailsResponse } from "@shared/api/v1/res";
import type { LocationAutocompleteHandle, RecentLocation } from "@/components/LocationAutocomplete";
import { LocationPermissionError } from "@/hooks/locationPermissionError";
import { useLocationField, type SelectedLocation } from "./useLocationField";

/**
 * #1133 「どのあたりで探す」の振る舞いをホーム（検索タブ）と保存料理タブで共有するためのフック。
 *
 * ここで固定したいのは、保存料理タブに機能を足す過程で**ホームの既存挙動が変質しないこと**と、
 * ホームにしか無かった細かい仕様（失敗時の手入力誘導・最近使った場所は API を叩き直さない・
 * 再選択で MRU 先頭へ）が、共通化の過程で落ちないこと。
 * これらは落ちても型では気付けず、画面を触って初めて判る種類の差分なので、テストで押さえる。
 *
 * ⚠️ 「最近使った場所」への登録（viewport を落として保存する）はこのフックの責務ではない。
 * details が解決する頃にはフォームが閉じており、登録は呼び出し元が行うため、
 * その検証は `features/profile/tabs/SavedDishCategoriesTab.test.tsx` にある。
 */

const mockGetCurrentLocation = jest.fn<Promise<Omit<LocationDetailsResponse, "viewport">>, []>();
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({ getCurrentLocation: () => mockGetCurrentLocation() }),
}));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));

// 翻訳の中身ではなくキーを見たいので、t はキーをそのまま返す
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockAddRecentLocation = jest.fn();
const mockClearRecentLocations = jest.fn();
let mockRecentLocations: RecentLocation[] = [];
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({
		recentLocations: mockRecentLocations,
		isLoading: false,
		addRecentLocation: mockAddRecentLocation,
		clearRecentLocations: mockClearRecentLocations,
	}),
}));

const shibuya: RecentLocation = {
	location: { latitude: 35.658, longitude: 139.701 },
	address: "country:JP, locality:Tokyo",
	localLanguageCode: "ja",
	locationQuery: "渋谷駅",
};

const currentPosition: Omit<LocationDetailsResponse, "viewport"> = {
	location: { latitude: 35.68, longitude: 139.76 },
	address: "country:JP, locality:Tokyo",
	localLanguageCode: "ja",
};

describe("#1133 useLocationField", () => {
	const onSelected = jest.fn<void, [SelectedLocation]>();
	const focus = jest.fn();

	let field: ReturnType<typeof useLocationField>;
	let renderer: TestRenderer.ReactTestRenderer;

	const Probe = () => {
		field = useLocationField({ screen: "profile_saved_topics", onSelected });
		// 実際には LocationAutocomplete が ref に流し込む handle を模す
		field.inputRef.current = { focus } as LocationAutocompleteHandle;
		return null;
	};

	const mount = async () => {
		await act(async () => {
			renderer = TestRenderer.create(<Probe />);
		});
	};

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockRecentLocations = [];
	});

	afterEach(async () => {
		await act(async () => {
			renderer?.unmount();
		});
	});

	it("現在地の取得に成功したら、確定済みの地点として通知し表示を『現在地』にする", async () => {
		mockGetCurrentLocation.mockResolvedValue(currentPosition);
		await mount();

		await act(async () => {
			await field.handleUseCurrentLocation();
		});

		// place_id を持たない経路なので、呼び出し元が details を取り直さないよう resolved で渡す
		expect(onSelected).toHaveBeenCalledWith({
			kind: "resolved",
			location: currentPosition,
			locationQuery: "Search.currentLocation",
		});
		expect(field.locationQuery).toBe("Search.currentLocation");
		expect(mockShowSnackbar).not.toHaveBeenCalled();
		// イベント名はホームと同一のまま、出所だけ payload で区別する
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				event_name: "current_location_success",
				payload: expect.objectContaining({ screen: "profile_saved_topics" }),
			}),
		);
	});

	it("権限拒否で失敗したら、理由に応じた文言を出して手入力へフォーカスを誘導する", async () => {
		mockGetCurrentLocation.mockRejectedValue(new LocationPermissionError("denied", "location permission denied"));
		await mount();

		await act(async () => {
			await field.handleUseCurrentLocation();
		});

		expect(onSelected).not.toHaveBeenCalled();
		expect(mockShowSnackbar).toHaveBeenCalledWith("Search.errors.getCurrentLocationDenied");
		// 再試行しても直らない失敗なので、ここで入力欄へ誘導しないとユーザーは詰まる
		expect(focus).toHaveBeenCalled();
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				event_name: "current_location_failed",
				payload: expect.objectContaining({ kind: "denied", screen: "profile_saved_topics" }),
			}),
		);
	});

	it("タイムアウトで失敗したら文言は出すが、フォーカスは奪わない（もう一度押せる状態を保つ）", async () => {
		mockGetCurrentLocation.mockRejectedValue(new LocationPermissionError("timeout", "timed out"));
		await mount();

		await act(async () => {
			await field.handleUseCurrentLocation();
		});

		expect(mockShowSnackbar).toHaveBeenCalledWith("Search.errors.getCurrentLocationTimeout");
		expect(focus).not.toHaveBeenCalled();
	});

	it("最近使った場所を選んだら、位置情報 API を一切呼ばずに確定済みの地点として通知する", async () => {
		mockRecentLocations = [shibuya];
		await mount();

		await act(async () => {
			field.handleSelectRecentLocation(shibuya);
		});

		// 保存済みの緯度経度をそのまま復元するのが #953 の要点。ここで API を叩くと課金と待ち時間が増える
		expect(mockGetCurrentLocation).not.toHaveBeenCalled();
		expect(onSelected).toHaveBeenCalledWith({
			kind: "resolved",
			location: shibuya,
			locationQuery: "渋谷駅",
		});
		expect(field.locationQuery).toBe("渋谷駅");
	});

	it("#1129 最近使った場所を再選択したら MRU の先頭へ引き上げる（ホームと同じ挙動にする）", async () => {
		mockRecentLocations = [shibuya];
		await mount();

		await act(async () => {
			field.handleSelectRecentLocation(shibuya);
		});

		// #1129 はホームの画面側に実装されていてフック内に無いため、ここで呼ばないと
		// 「ホームでは先頭に来るが保存料理では来ない」不整合になる
		expect(mockAddRecentLocation).toHaveBeenCalledWith(shibuya);
	});

	it("サジェスト選択は details を取りに行かず、未解決のまま呼び出し元へ委ねる", async () => {
		await mount();
		const prediction = {
			place_id: "place-1",
			text: "京都駅",
			mainText: "京都駅",
			secondaryText: "京都府京都市",
			types: ["train_station"],
		};

		await act(async () => {
			field.handleSelectSuggestion(prediction);
		});

		expect(onSelected).toHaveBeenCalledWith({ kind: "prediction", prediction, locationQuery: "京都駅" });
		expect(field.locationQuery).toBe("京都駅");
		// details をここで取ると、遷移前に待たされる。取得の要否とタイミングは呼び出し元の判断に残す
		expect(mockAddRecentLocation).not.toHaveBeenCalled();
	});

	it("クリアは入力を空に戻すだけで、地点の確定は通知しない", async () => {
		await mount();

		await act(async () => {
			field.handleSelectSuggestion({
				place_id: "place-1",
				text: "京都駅",
				mainText: "京都駅",
				secondaryText: "京都府京都市",
				types: [],
			});
		});
		onSelected.mockClear();

		await act(async () => {
			field.handleClear();
		});

		expect(field.locationQuery).toBe("");
		expect(onSelected).not.toHaveBeenCalled();
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				event_name: "location_cleared",
				payload: expect.objectContaining({ screen: "profile_saved_topics" }),
			}),
		);
	});
});
