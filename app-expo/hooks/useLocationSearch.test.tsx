import { act } from "react";
import TestRenderer from "react-test-renderer";
import * as Location from "expo-location";
import { useLocationSearch } from "./useLocationSearch";

/**
 * #1196 の混入経路そのものを固定するテスト。
 *
 * 現在地取得はまずバックエンドの逆ジオコーディング (`/v1/locations/reverse-geocoding`) を呼び、
 * そこが正規形式 "country:JP, ..." の address を返す。**バックエンドが失敗したときの
 * expo フォールバック**が旧実装では `r.city`（= "大阪市"）をそのまま address にしていたため、
 * サーバ側で `region:大阪市` となり gate whitelist に当たらず候補0件 → Claude フォールバック →
 * Claude 側の失敗、という連鎖が本番で 1日 1,445件 / 204ユーザー発生していた。
 *
 * 認証未確立でこの経路に入ると成功扱いで返るため（`useAutoCurrentLocation` は再試行しない）、
 * 起動直後の自動取得がそのまま壊れた address を掴む。ここを外すと障害が再発する。
 */

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockGetCurrentLocationPosition = jest.fn();
jest.mock("./useCurrentLocationPosition", () => ({
	getCurrentLocationPosition: () => mockGetCurrentLocationPosition(),
}));

jest.mock("expo-crypto", () => ({ getRandomBytesAsync: jest.fn(async () => new Uint8Array(16)) }));

jest.mock("expo-location", () => ({ reverseGeocodeAsync: jest.fn() }));

const reverseGeocodeAsync = Location.reverseGeocodeAsync as unknown as jest.Mock;

/** 大阪市役所あたりの座標 */
const OSAKA = { latitude: 34.6937, longitude: 135.5023 };

/** `useLocationSearch()` をレンダリングして `getCurrentLocation` を取り出す */
const renderGetCurrentLocation = () => {
	let getCurrentLocation!: ReturnType<typeof useLocationSearch>["getCurrentLocation"];
	const Probe = () => {
		getCurrentLocation = useLocationSearch().getCurrentLocation;
		return null;
	};
	let renderer!: TestRenderer.ReactTestRenderer;
	TestRenderer.act(() => {
		renderer = TestRenderer.create(<Probe />);
	});
	return {
		getCurrentLocation: () => getCurrentLocation(),
		unmount: () =>
			TestRenderer.act(() => {
				renderer.unmount();
			}),
	};
};

describe("#1196 getCurrentLocation が返す address の形式", () => {
	beforeEach(() => {
		mockGetCurrentLocationPosition.mockResolvedValue(OSAKA);
	});

	it("バックエンドが成功した場合は、その正規形式の address をそのまま使う", async () => {
		mockCallBackend.mockResolvedValue({
			location: OSAKA,
			address: "country:JP, administrative_area_level_1:Osaka, locality:Osaka",
			localLanguageCode: "ja",
		});

		const probe = renderGetCurrentLocation();
		let result: Awaited<ReturnType<ReturnType<typeof renderGetCurrentLocation>["getCurrentLocation"]>>;
		await act(async () => {
			result = await probe.getCurrentLocation();
		});

		expect(result!.address).toBe("country:JP, administrative_area_level_1:Osaka, locality:Osaka");
		expect(reverseGeocodeAsync).not.toHaveBeenCalled();
		probe.unmount();
	});

	describe("バックエンドが失敗して expo フォールバックへ落ちたとき", () => {
		beforeEach(() => {
			// #1092 認証未確立でトークンが無い場合がこれに当たる（起動直後の自動取得）
			mockCallBackend.mockRejectedValue({ code: "unauthenticated", message: "no token" });
		});

		it("#1196 【本丸】市区町村名単体ではなく正規形式の address を返す", async () => {
			reverseGeocodeAsync.mockResolvedValue([{ isoCountryCode: "JP", region: "大阪府", city: "大阪市" }]);

			const probe = renderGetCurrentLocation();
			let result: any;
			await act(async () => {
				result = await probe.getCurrentLocation();
			});

			// 旧実装はここが "大阪市" になっていた（= 本番障害の原因）
			expect(result.address).not.toBe("大阪市");
			expect(result.address).toBe("country:JP, administrative_area_level_1:大阪府, locality:大阪市");
			probe.unmount();
		});

		it("正規形式を作れた場合はキャッシュに載せ、2回目は位置取得ごと省略する", async () => {
			reverseGeocodeAsync.mockResolvedValue([{ isoCountryCode: "JP", region: "大阪府", city: "大阪市" }]);

			const probe = renderGetCurrentLocation();
			await act(async () => {
				await probe.getCurrentLocation();
			});
			await act(async () => {
				await probe.getCurrentLocation();
			});

			expect(mockGetCurrentLocationPosition).toHaveBeenCalledTimes(1);
			probe.unmount();
		});

		it("#1196 【防御】正規形式を作れなかった場合はキャッシュせず、次回はバックエンドを再試行する", async () => {
			// 国コードが取れない（= 正規形式を組み立てられない）ケース
			reverseGeocodeAsync.mockResolvedValue([{ city: "大阪市" }]);

			const probe = renderGetCurrentLocation();
			let result: any;
			await act(async () => {
				result = await probe.getCurrentLocation();
			});

			// 壊れた address（市区町村名）を返さない。表示用の文字列に留める
			expect(result.address).not.toBe("大阪市");

			// 5分間 TTL のキャッシュに載せてしまうと、その間の検索が全部 Claude 経路へ落ちる
			await act(async () => {
				await probe.getCurrentLocation();
			});
			expect(mockGetCurrentLocationPosition).toHaveBeenCalledTimes(2);
			expect(mockCallBackend).toHaveBeenCalledTimes(2);
			probe.unmount();
		});

		it("#1196 【検知】正規形式を作れなかったことを warn ログに残す", async () => {
			reverseGeocodeAsync.mockResolvedValue([{ city: "大阪市" }]);

			const probe = renderGetCurrentLocation();
			await act(async () => {
				await probe.getCurrentLocation();
			});

			expect(mockLogFrontendEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					event_name: "current_location_address_format_degraded",
					error_level: "warn",
				}),
			);
			probe.unmount();
		});

		it("expo の逆ジオコーディングも失敗した場合でも壊れた address を返さない", async () => {
			reverseGeocodeAsync.mockRejectedValue(new Error("expo failed"));

			const probe = renderGetCurrentLocation();
			let result: any;
			await act(async () => {
				result = await probe.getCurrentLocation();
			});

			expect(result.address).toContain("Search.currentLocation");
			probe.unmount();
		});
	});
});
