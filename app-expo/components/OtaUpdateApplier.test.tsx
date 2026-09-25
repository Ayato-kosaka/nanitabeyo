import { act } from "react";
import TestRenderer from "react-test-renderer";
import { AppState } from "react-native";
import * as Updates from "expo-updates";
import { isPermanentUpdateFailure, OtaUpdateApplier } from "./OtaUpdateApplier";
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

/** #2069 直近の `ota_update_check_failed` の呼び出しそのもの（error_level も見たいので payload だけにしない） */
const lastCheckFailedCall = () =>
	mockLogFrontendEvent.mock.calls
		.map(([arg]) => arg)
		.reverse()
		.find((arg) => arg?.event_name === "ota_update_check_failed");

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

/**
 * #2069 **«撃ち直せば直る失敗» と «撃ち直しても直らない失敗» を同じ `warn` に混ぜない。**
 *
 * 2026-09-24 から本番の OTA が 1 件も届かなくなった（Expo 無料枠の MAU 超過で更新チェックが
 * 全件 429）。それでも 2 日間・800 件超の間、起票が 1 件も無かった。失敗を全部 `warn` で
 * 記録していて、error-triage は `error_level = 'error'` しか集めないためである。
 *
 * ここで固定するのは **パターン**（個別の文言ではなく「恒久的な失敗を warn に混ぜない」）である。
 */
describe("#2069 更新チェックの失敗を «直らないもの» と «直るもの» に分ける", () => {
	// ⚠️ 期待値は **本番ログの実文言**（30 日で出ていた 6 種すべて）。写経ではなく実測から取った。
	const PERMANENT = [
		"HTTP response error 429: The number of Monthly Updating Users has exceeded the Free tier's quota for this account. Subscribe to Expo Application Services to remove this limit.",
	];
	const TRANSIENT = [
		"Unknown error: リクエストがタイムアウトになりました。",
		"Unknown error: ネットワーク接続が切れました。",
		"Unknown error: TLSエラーが起きたため、セキュリティ保護された接続を確立できませんでした。",
		"Failed to load all assets",
		// ⚠️ ネイティブ側の包みは理由を含まないので **判定できない**。warn に倒す（既知の取りこぼし）
		"Call to function 'ExpoUpdates.checkForUpdateAsync' has been rejected.\n→ Caused by: Failed to check for update",
	];

	test.each(PERMANENT)("恒久的と判定する: %s", (message) => {
		expect(isPermanentUpdateFailure(message)).toBe(true);
	});

	test.each(TRANSIENT)("恒久的とは判定しない（warn のまま）: %s", (message) => {
		expect(isPermanentUpdateFailure(message)).toBe(false);
	});

	it("枠の使い切りは error_level: error で記録する（error-triage が集める側へ載る）", async () => {
		mockUpdates.checkForUpdateAsync.mockRejectedValue(new Error(PERMANENT[0]));
		await mountAndSettle();

		const logged = lastCheckFailedCall();
		expect(logged?.error_level).toBe("error");
		expect(logged?.payload?.permanent).toBe(true);
	});

	it("回線起因は warn のまま（毎晩起票させない）", async () => {
		mockUpdates.checkForUpdateAsync.mockRejectedValue(new Error(TRANSIENT[0]));
		await mountAndSettle();

		const logged = lastCheckFailedCall();
		expect(logged?.error_level).toBe("warn");
		expect(logged?.payload?.permanent).toBe(false);
	});

	it("判定できなかった失敗を後から切り分けられるよう platform を残す", async () => {
		mockUpdates.checkForUpdateAsync.mockRejectedValue(new Error(TRANSIENT[4]));
		await mountAndSettle();

		expect(lastCheckFailedCall()?.payload?.platform).toBeTruthy();
	});
});
