import type { PanGesture } from "react-native-gesture-handler";
import {
	CAROUSEL_ACTIVE_OFFSET_X,
	CAROUSEL_DRAG_RESET_TIMEOUT_MS,
	CAROUSEL_FAIL_OFFSET_Y,
	configureCarouselPanGesture,
	isSheetDraggable,
} from "./savedRestaurantsSheetGesture";

/**
 * Android の `ViewConfiguration.getScaledTouchSlop()`（＝ BottomSheetBehavior がシートを
 * 掴み始める縦方向のしきい値）。実機では 8dp。テスト内の期待値の根拠としてのみ使う。
 */
const ANDROID_SHEET_TOUCH_SLOP_DP = 8;

type Recorder = {
	gesture: Pick<PanGesture, "activeOffsetX" | "failOffsetY">;
	activeOffsetX: jest.Mock;
	failOffsetY: jest.Mock;
};

function createGestureRecorder(): Recorder {
	const activeOffsetX = jest.fn(() => gesture);
	const failOffsetY = jest.fn(() => gesture);
	const gesture = { activeOffsetX, failOffsetY } as unknown as Pick<PanGesture, "activeOffsetX" | "failOffsetY">;
	return { gesture, activeOffsetX, failOffsetY };
}

describe("#1126 configureCarouselPanGesture", () => {
	it("横方向のしきい値（activeOffsetX）を左右対称に設定する", () => {
		const { gesture, activeOffsetX } = createGestureRecorder();
		configureCarouselPanGesture(gesture);
		expect(activeOffsetX).toHaveBeenCalledTimes(1);
		expect(activeOffsetX).toHaveBeenCalledWith([-CAROUSEL_ACTIVE_OFFSET_X, CAROUSEL_ACTIVE_OFFSET_X]);
	});

	it("縦方向へ動いたら fail するよう failOffsetY を上下対称に設定する", () => {
		const { gesture, failOffsetY } = createGestureRecorder();
		configureCarouselPanGesture(gesture);
		expect(failOffsetY).toHaveBeenCalledTimes(1);
		expect(failOffsetY).toHaveBeenCalledWith([-CAROUSEL_FAIL_OFFSET_Y, CAROUSEL_FAIL_OFFSET_Y]);
	});

	it("activeOffsetX と failOffsetY の両方を設定する（片方だけでは方向の排他にならない）", () => {
		const { gesture, activeOffsetX, failOffsetY } = createGestureRecorder();
		configureCarouselPanGesture(gesture);
		expect(activeOffsetX).toHaveBeenCalled();
		expect(failOffsetY).toHaveBeenCalled();
	});
});

describe("#1126 カルーセルのしきい値の関係", () => {
	it("横（activeOffsetX）より縦（failOffsetY）を大きくして横スワイプを優先する", () => {
		expect(CAROUSEL_FAIL_OFFSET_Y).toBeGreaterThan(CAROUSEL_ACTIVE_OFFSET_X);
	});

	it("failOffsetY は Android のシート touchSlop(8dp) より大きい（縦へ引けばシートが先に反応する）", () => {
		// これが逆転すると、意図的な縦ドラッグでもカルーセルが先に fail するだけでシートが掴めず、
		// 「展開できない」という機能欠落になる
		expect(CAROUSEL_FAIL_OFFSET_Y).toBeGreaterThan(ANDROID_SHEET_TOUCH_SLOP_DP);
	});

	it("しきい値は正の有限値である", () => {
		for (const value of [CAROUSEL_ACTIVE_OFFSET_X, CAROUSEL_FAIL_OFFSET_Y, CAROUSEL_DRAG_RESET_TIMEOUT_MS]) {
			expect(Number.isFinite(value)).toBe(true);
			expect(value).toBeGreaterThan(0);
		}
	});
});

describe("#1126 isSheetDraggable", () => {
	it("カルーセル表示中に横スワイプしている間はシートを掴ませない", () => {
		expect(isSheetDraggable(0, true)).toBe(false);
	});

	it("カルーセル表示中でも横スワイプしていなければ縦ドラッグで展開できる", () => {
		// 「敏感すぎる」の修正であって縦ジェスチャの削除ではないので、ここは必ず true
		expect(isSheetDraggable(0, false)).toBe(true);
	});

	it("展開後（縦並びリスト）は常に掴める", () => {
		expect(isSheetDraggable(1, false)).toBe(true);
		expect(isSheetDraggable(1, true)).toBe(true);
	});
});
