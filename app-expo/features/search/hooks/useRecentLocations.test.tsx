import TestRenderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRecentLocations } from "./useRecentLocations";
import type { RecentLocation } from "./useRecentLocations";

/**
 * #1196 「最近使った場所」は端末ローカル(AsyncStorage)に保存されるため、
 * 一度壊れた address が入ると**サーバ側でもコード修正でも救えない**。
 *
 * 保存経路は「autocomplete で選択 → details API 成功」の 1 箇所だけで、details API は
 * 正規形式 "country:JP, ..." を返し続けているため、理屈のうえでは壊れた値は入らない。
 * ただし入ってしまった場合の被害（その地点を選ぶ限り毎回 Claude フォールバックへ落ちる）が
 * 大きいので、読み出し時に形式を検査して壊れたエントリだけを捨てる。
 *
 * キーのバージョンを上げる（v1 → v2）方式を採らないのは、正常なエントリまで全消しになり
 * 利便性を落とすため。
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
	getItem: jest.fn(),
	setItem: jest.fn(async () => undefined),
	removeItem: jest.fn(async () => undefined),
}));

const mockedAsyncStorage = AsyncStorage as unknown as {
	getItem: jest.Mock;
	setItem: jest.Mock;
	removeItem: jest.Mock;
};

const STORAGE_KEY = "recent_locations_v1";

const buildEntry = (address: string, latitude: number, locationQuery: string): RecentLocation =>
	({
		location: { latitude, longitude: 135 },
		address,
		localLanguageCode: "ja",
		locationQuery,
	}) as RecentLocation;

/** 正規形式（details API が返す形） */
const validEntry = buildEntry("country:JP, administrative_area_level_1:Osaka, locality:Osaka", 34.69, "大阪駅");
const validEntry2 = buildEntry("country:JP, administrative_area_level_1:Tokyo, locality:Tokyo", 35.68, "東京駅");
/** #1196 壊れた形式（市区町村名単体） */
const brokenEntry = buildEntry("大阪市", 34.7, "大阪市");

/** `useRecentLocations()` をレンダリングして最新の戻り値を読む */
const renderRecentLocations = async () => {
	let latest!: ReturnType<typeof useRecentLocations>;
	const Probe = () => {
		latest = useRecentLocations();
		return null;
	};
	let renderer!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		renderer = TestRenderer.create(<Probe />);
	});
	return {
		get current() {
			return latest;
		},
		unmount: () =>
			act(() => {
				renderer.unmount();
			}),
	};
};

describe("#1196 useRecentLocations は壊れた形式の address を読み込まない", () => {
	it("正規形式のエントリはそのまま復元する", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify([validEntry, validEntry2]));

		const probe = await renderRecentLocations();

		expect(probe.current.recentLocations).toEqual([validEntry, validEntry2]);
		// 変更が無いので書き戻さない
		expect(mockedAsyncStorage.setItem).not.toHaveBeenCalled();
		await probe.unmount();
	});

	it("#1196 【本丸】市区町村名単体のエントリは破棄し、正常なエントリだけ残す", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify([brokenEntry, validEntry]));

		const probe = await renderRecentLocations();

		expect(probe.current.recentLocations).toEqual([validEntry]);
		await probe.unmount();
	});

	it("破棄した結果を保存内容にも書き戻す（次回以降も残り続けないこと）", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify([brokenEntry, validEntry]));

		const probe = await renderRecentLocations();

		expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify([validEntry]));
		await probe.unmount();
	});

	it("address が欠けているエントリも破棄する", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue(
			JSON.stringify([{ location: { latitude: 1, longitude: 2 }, locationQuery: "壊れた保存値" }]),
		);

		const probe = await renderRecentLocations();

		expect(probe.current.recentLocations).toEqual([]);
		await probe.unmount();
	});

	it("保存が空のときは空配列を返し、書き戻しもしない", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue(null);

		const probe = await renderRecentLocations();

		expect(probe.current.recentLocations).toEqual([]);
		expect(mockedAsyncStorage.setItem).not.toHaveBeenCalled();
		await probe.unmount();
	});

	it("保存値が壊れた JSON でも落ちず、空配列にフォールバックする", async () => {
		mockedAsyncStorage.getItem.mockResolvedValue("{ not json");
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

		const probe = await renderRecentLocations();

		expect(probe.current.recentLocations).toEqual([]);
		await probe.unmount();
		consoleError.mockRestore();
	});
});
