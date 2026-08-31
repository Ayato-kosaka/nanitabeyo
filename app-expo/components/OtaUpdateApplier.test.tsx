import { act } from "react";
import TestRenderer from "react-test-renderer";
import { AppState } from "react-native";
import * as Updates from "expo-updates";
import { OtaUpdateApplier } from "./OtaUpdateApplier";
import { flushLogQueue } from "@/lib/logQueue";

/**
 * #1641 OTA が «次の起動» まで当たらず、オーナー端末が常に 1 つ前の JS を走らせていた。
 * 実測（BigQuery / frontend_event_logs）: 08-31 に OTA を 12 本出した日、端末が実際に
 * 走らせた最新コミットは前日の 9b646339 で、当日の修正は 1 本も動いていなかった。
 *
 * ここで固定したいのは «作り直す条件» である。作り直しは画面の状態を飛ばすので、
 * 緩めると «動画を見ている最中に再起動する» に化ける。
 */

jest.mock("expo-updates", () => ({
	isEnabled: true,
	channel: "preview",
	runtimeVersion: "1.14",
	updateId: "update-old",
	checkForUpdateAsync: jest.fn(),
	fetchUpdateAsync: jest.fn(),
	reloadAsync: jest.fn(),
}));

jest.mock("@/lib/logQueue", () => ({ flushLogQueue: jest.fn() }));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

const mockUpdates = Updates as unknown as {
	isEnabled: boolean;
	channel: string | null;
	checkForUpdateAsync: jest.Mock;
	fetchUpdateAsync: jest.Mock;
	reloadAsync: jest.Mock;
};

/** AppState.addEventListener を差し替え、テストから前面/背面を切り替えられるようにする */
const captureAppState = () => {
	let handler: ((state: string) => void) | null = null;
	jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, cb: any) => {
		handler = cb;
		return { remove: jest.fn() };
	}) as any);
	return {
		toBackground: () => act(() => handler?.("background")),
		toActive: () => act(() => handler?.("active")),
		advance: (ms: number) => act(() => jest.advanceTimersByTime(ms)),
	};
};

/** マウントし、起動時の check → fetch が終わるまで待つ */
const mountAndSettle = async () => {
	await act(async () => {
		TestRenderer.create(<OtaUpdateApplier />);
	});
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
};

beforeEach(() => {
	jest.useFakeTimers();
	mockUpdates.isEnabled = true;
	mockUpdates.channel = "preview";
	mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
	mockUpdates.fetchUpdateAsync.mockResolvedValue({ isNew: true, manifest: { id: "update-new" } });
	mockLogFrontendEvent.mockClear();
});

afterEach(() => {
	jest.useRealTimers();
	jest.restoreAllMocks();
});

describe("OtaUpdateApplier", () => {
	it("channel の無いビルド（ローカル prebuild / E2E CI）では更新を確認すらしない", async () => {
		mockUpdates.channel = null;
		captureAppState();

		await mountAndSettle();

		expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
		expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
	});

	it("起動時に更新があれば取得しておく（この時点では作り直さない）", async () => {
		captureAppState();

		await mountAndSettle();

		expect(mockUpdates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
		expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({ event_name: "ota_update_downloaded" }),
		);
	});

	it("背面に一瞬しか居なかった復帰では作り直さない（アプリ切り替えで画面が飛ばない）", async () => {
		const appState = captureAppState();
		await mountAndSettle();

		appState.toBackground();
		appState.advance(3_000);
		appState.toActive();
		appState.advance(10_000);

		expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
	});

	it("十分に背面へ居てから戻ったら、ログを送り切ってから作り直す", async () => {
		const appState = captureAppState();
		await mountAndSettle();

		appState.toBackground();
		appState.advance(30_000);
		appState.toActive();

		expect(mockLogFrontendEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				event_name: "ota_update_applied",
				payload: expect.objectContaining({ toUpdateId: "update-new" }),
			}),
		);
		expect(flushLogQueue).toHaveBeenCalled();
		// 送信の猶予を待たずに作り直すとログごと消える
		expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();

		appState.advance(2_000);
		expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
	});

	it("作り直しは 1 セッションに 1 回だけ（確認→取得→作り直しが回り続けない）", async () => {
		const appState = captureAppState();
		await mountAndSettle();

		appState.toBackground();
		appState.advance(30_000);
		appState.toActive();
		appState.advance(2_000);

		appState.toBackground();
		appState.advance(30_000);
		appState.toActive();
		appState.advance(2_000);

		expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
	});
});
