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
 * ここで固定したいのは «作り直す条件» である。緩めれば «動画を見ている最中に再起動する» に、
 * 締めれば «また 1 つ前の JS を触らせる» に化ける。両側を押さえる。
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

/** 保留中の非同期（check → fetch）を進める */
const flush = async () => {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
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

const mountAndSettle = async () => {
	await act(async () => {
		TestRenderer.create(<OtaUpdateApplier />);
	});
	await flush();
};

const lastAppliedPayload = () => {
	const call = mockLogFrontendEvent.mock.calls
		.map(([arg]) => arg)
		.reverse()
		.find((arg) => arg?.event_name === "ota_update_applied");
	return call?.payload;
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
	it("channel の無いビルド（ローカル prebuild / dev client / E2E CI）では更新を確認すらしない", async () => {
		mockUpdates.channel = null;
		const appState = captureAppState();

		await mountAndSettle();
		appState.advance(60_000);

		expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
		expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
	});

	it("起動直後に取得できたら、前面復帰を待たずにその場で当てる", async () => {
		const appState = captureAppState();

		await mountAndSettle();

		expect(mockUpdates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
		expect(lastAppliedPayload()).toEqual(expect.objectContaining({ reason: "launch", toUpdateId: "update-new" }));
		// ログを送り切る猶予より前に作り直すと、その記録ごと消える
		expect(flushLogQueue).toHaveBeenCalled();
		expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();

		appState.advance(2_000);
		expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
	});

	describe("アプリを使っている最中に公開された更新", () => {
		/** 起動時は «更新なし»、以降は «あり» を返す。起動から 20 秒経った状態にする */
		const arriveAfterLaunch = async () => {
			mockUpdates.checkForUpdateAsync.mockResolvedValueOnce({ isAvailable: false });
			const appState = captureAppState();
			await mountAndSettle();
			expect(mockUpdates.fetchUpdateAsync).not.toHaveBeenCalled();
			appState.advance(20_000);
			return appState;
		};

		it("見つけた復帰では当てない（取得だけして、次の機会を待つ）", async () => {
			const appState = await arriveAfterLaunch();

			appState.toBackground();
			appState.advance(30_000);
			appState.toActive();
			await flush();

			expect(mockLogFrontendEvent).toHaveBeenCalledWith(
				expect.objectContaining({ event_name: "ota_update_downloaded" }),
			);
			expect(lastAppliedPayload()).toBeUndefined();
			appState.advance(5_000);
			expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
		});

		it("背面に一瞬しか居なかった復帰では当てない（切り替えただけで画面が飛ばない）", async () => {
			const appState = await arriveAfterLaunch();

			appState.toBackground();
			appState.advance(30_000);
			appState.toActive();
			await flush();

			appState.toBackground();
			appState.advance(3_000);
			appState.toActive();
			appState.advance(10_000);

			expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
		});

		it("十分に背面へ居てから戻ったら当てる", async () => {
			const appState = await arriveAfterLaunch();

			appState.toBackground();
			appState.advance(30_000);
			appState.toActive();
			await flush();

			appState.toBackground();
			appState.advance(30_000);
			appState.toActive();

			expect(lastAppliedPayload()).toEqual(
				expect.objectContaining({ reason: "foreground", toUpdateId: "update-new" }),
			);
			expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();

			appState.advance(2_000);
			expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
		});
	});

	it("作り直しは 1 セッションに 1 回だけ（確認 → 取得 → 作り直しが回り続けない）", async () => {
		const appState = captureAppState();
		await mountAndSettle();
		appState.advance(2_000);

		appState.toBackground();
		appState.advance(30_000);
		appState.toActive();
		await flush();
		appState.advance(2_000);

		expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
	});
});
