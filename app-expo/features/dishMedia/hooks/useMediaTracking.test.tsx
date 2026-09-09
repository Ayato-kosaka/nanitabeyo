import { act } from "react";
import TestRenderer from "react-test-renderer";
import { useMediaTracking } from "./useMediaTracking";

/*
#1785 «表示ログ / 視聴ログの送信に失敗したとき» だけを見るテスト。

このフックの送信は 2 本とも **投げっぱなし**（await しない）である。`callBackend` は
失敗を **Error ではない素のオブジェクト**（`ApiError`）で throw するので、`.catch()` が
無いと `unhandledrejection` になる。ブラウザにはそれが «原因の分からないエラー» として
残るだけで、素のオブジェクトには stack が無いため発生源すら出ない
（e2e-web の失敗ログに `[pageerror] Object` としか出ていなかったのがこれ）。

⚠️ **ログの送信が失敗しても、画面は何も壊れてはいけない。** ここが守るのはその 1 点である。
*/

const mockLogFrontendEvent = jest.fn();
const mockCallBackend = jest.fn();

jest.mock("@/hooks/useLogger", () => ({
	useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }),
}));
jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
}));
jest.mock("@/lib/remoteConfig", () => ({
	getRemoteConfig: () => ({ v1_dish_media_image_completion_threshold_ms: "3000" }),
}));
jest.mock("@/lib/uuid", () => ({ generateUUID: () => "impression-1" }));

/** このフックが読むフィールドだけを持つ最小の dish_media */
const dishMedia = { id: "media-1", media_type: "image" } as never;

const Probe = ({ isActive }: { isActive: boolean }) => {
	useMediaTracking({ isActive, sessionId: "session-1", source: "test", dishMedia });
	return null;
};

/** `path` を含む呼び出しの回数 */
const callCountFor = (path: string): number =>
	mockCallBackend.mock.calls.filter(([endpoint]) => String(endpoint).includes(path)).length;

/** イベント名で `logFrontendEvent` の呼び出しを引く */
const loggedEvent = (name: string) =>
	mockLogFrontendEvent.mock.calls.find(([payload]) => payload?.event_name === name)?.[0];

describe("useMediaTracking のログ送信は失敗しても画面を壊さない（#1785）", () => {
	beforeEach(() => {
		// 視聴時間の計測は setInterval を回し続けるので、実時間で待たない
		jest.useFakeTimers();
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockLogFrontendEvent.mockClear();
		mockCallBackend.mockReset();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("表示ログの送信が失敗しても、拾われずに漏れる拒否を作らない", async () => {
		// `callBackend` が投げるのは Error ではない素のオブジェクトである（hooks/useAPICall.ts）
		mockCallBackend.mockRejectedValue({ code: "invalid_response", message: "boom" });

		let renderer!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			renderer = TestRenderer.create(<Probe isActive={true} />);
		});

		expect(callCountFor("/impression")).toBe(1);
		expect(loggedEvent("dish_media_impression_send_error")).toBeDefined();

		await act(async () => {
			renderer.unmount();
		});
	});

	it("視聴ログの送信が 1 度失敗しても、次の視聴ログは送れる（送信中フラグが残らない）", async () => {
		mockCallBackend.mockRejectedValue({ code: "network_error", message: "boom" });

		let renderer!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			renderer = TestRenderer.create(<Probe isActive={true} />);
		});

		// 非アクティブになると視聴ログを送る（ここで失敗する）
		await act(async () => {
			renderer.update(<Probe isActive={false} />);
		});
		// ⚠️ 回数そのものを固定しない。非アクティブ化では «前の effect の後始末» と
		//    «新しい effect の !isActive 分岐» の両方が送信を試みるので、回数は実装の都合で動く。
		//    ここで見たいのは «失敗した後も送信を試みられるか» である
		const afterFirstDeactivate = callCountFor("/view");
		expect(afterFirstDeactivate).toBeGreaterThanOrEqual(1);
		expect(loggedEvent("dish_media_view_send_cleanup_error")).toBeDefined();

		// ⚠️ ここが本命。送信中フラグを成功時にしか戻していなかったため、1 度失敗すると
		//    このメディアの視聴ログは **二度と送られなくなっていた**（早期 return に永久に掛かる）
		await act(async () => {
			renderer.update(<Probe isActive={true} />);
		});
		await act(async () => {
			renderer.update(<Probe isActive={false} />);
		});
		expect(callCountFor("/view")).toBeGreaterThan(afterFirstDeactivate);

		await act(async () => {
			renderer.unmount();
		});
	});
});
