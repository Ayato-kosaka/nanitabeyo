/*
#1375（実機: 「クラッシュはマップ画面だけじゃない」）

**このテストが守るのは «クラッシュが記録に残ること» そのもの。**

これを入れるまで、アプリはクラッシュを 1 件も観測していなかった。
落ちても記録が残らないので、オーナーが実機で踏んで言ってくるまで誰も気づけない。

⚠️ ここが落ちたら «また見えない状態に戻っている»。
期待値を実装へ合わせるのではなく、記録が積まれない理由を疑うこと。
*/
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { enqueueLog } from "@/lib/logQueue";
import {
	JS_UNCAUGHT_ERROR_EVENT,
	PREVIOUS_SESSION_CRASHED_EVENT,
	installCrashReporting,
	reportPreviousSessionCrash,
	setCrashReportingPathName,
} from "./crashReporting";

jest.mock("@react-native-async-storage/async-storage", () => ({
	__esModule: true,
	default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock("@/lib/logQueue", () => ({ enqueueLog: jest.fn() }));

const storage = AsyncStorage as unknown as {
	getItem: jest.Mock;
	setItem: jest.Mock;
	removeItem: jest.Mock;
};
const enqueue = enqueueLog as unknown as jest.Mock;

/** 積まれたログのうち、指定イベント名のもの */
const logged = (eventName: string) => enqueue.mock.calls.map((c) => c[0]).filter((d) => d.event_name === eventName);

beforeEach(() => {
	enqueue.mockClear();
	storage.getItem.mockReset().mockResolvedValue(null);
	storage.setItem.mockReset().mockResolvedValue(undefined);
	storage.removeItem.mockReset().mockResolvedValue(undefined);
});

describe("前回の異常終了（ネイティブのクラッシュを次回起動で拾う）", () => {
	it("«まだ生きている» 印が残っていたら、前回は落ちたものとして記録する", async () => {
		storage.getItem.mockResolvedValue(
			JSON.stringify({
				startedAt: "2026-08-25T00:00:00.000Z",
				pathName: "/ja-JP/my-dishes",
				appVersion: "1.14.0",
				commitId: "abc123",
				platform: "android",
			}),
		);

		await expect(reportPreviousSessionCrash()).resolves.toBe(true);

		const entries = logged(PREVIOUS_SESSION_CRASHED_EVENT);
		expect(entries).toHaveLength(1);
		// «どこで落ちたか» が残ること。これが無いと «マップだけなのか» に答えられない
		expect(entries[0].path_name).toBe("/ja-JP/my-dishes");
		expect(entries[0].error_level).toBe("error");
		expect(entries[0].payload.previousPlatform).toBe("android");
		// 二重に記録しないよう、読んだ印は消す
		expect(storage.removeItem).toHaveBeenCalled();
	});

	it("印が無ければ何も記録しない（正常に終了した前回を «落ちた» と言わない）", async () => {
		storage.getItem.mockResolvedValue(null);
		await expect(reportPreviousSessionCrash()).resolves.toBe(false);
		expect(logged(PREVIOUS_SESSION_CRASHED_EVENT)).toHaveLength(0);
	});

	it("印が壊れていても «落ちた» という事実は残す", async () => {
		storage.getItem.mockResolvedValue("{壊れている");
		await expect(reportPreviousSessionCrash()).resolves.toBe(true);
		expect(logged(PREVIOUS_SESSION_CRASHED_EVENT)).toHaveLength(1);
	});

	it("保存領域が読めなくても投げない（クラッシュの記録でクラッシュしない）", async () => {
		storage.getItem.mockRejectedValue(new Error("storage unavailable"));
		await expect(reportPreviousSessionCrash()).resolves.toBe(false);
	});
});

describe("installCrashReporting", () => {
	it("レンダー外の JS 例外を記録し、既定のハンドラも必ず呼ぶ", async () => {
		const previous = jest.fn();
		let handler: ((error: unknown, isFatal?: boolean) => void) | undefined;
		(globalThis as any).ErrorUtils = {
			getGlobalHandler: () => previous,
			setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => {
				handler = h;
			},
		};

		const uninstall = installCrashReporting();
		setCrashReportingPathName("/ja-JP/search");
		await Promise.resolve();

		const error = new Error("boom");
		handler?.(error, true);

		const entries = logged(JS_UNCAUGHT_ERROR_EVENT);
		expect(entries).toHaveLength(1);
		expect(entries[0].payload.message).toBe("boom");
		expect(entries[0].payload.isFatal).toBe(true);
		expect(entries[0].path_name).toBe("/ja-JP/search");
		// ⚠️ 既定のハンドラを呼ばないと、開発時の赤い画面が出なくなる
		expect(previous).toHaveBeenCalledWith(error, true);

		uninstall();
		delete (globalThis as any).ErrorUtils;
	});

	it("前面を離れたら印を消す（正常終了を «落ちた» と数えない）", async () => {
		const listeners: ((state: string) => void)[] = [];
		const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, cb: any) => {
			listeners.push(cb);
			return { remove: jest.fn() };
		}) as never);

		const uninstall = installCrashReporting();
		await Promise.resolve();
		storage.removeItem.mockClear();

		listeners.forEach((cb) => cb("background"));
		await Promise.resolve();
		expect(storage.removeItem).toHaveBeenCalled();

		storage.setItem.mockClear();
		listeners.forEach((cb) => cb("active"));
		await Promise.resolve();
		expect(storage.setItem).toHaveBeenCalled();

		uninstall();
		spy.mockRestore();
	});
});
