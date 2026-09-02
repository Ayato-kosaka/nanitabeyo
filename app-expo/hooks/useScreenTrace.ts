import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { getPerformance, trace } from "@react-native-firebase/perf";

const SCREEN_TRACE_PREFIX = "screen_";

/**
 * #1016 【設計】画面のフォーカス〜フォーカス解除をFirebase Performance Monitoringのカスタムトレースとして計測する。
 * `newScreenTrace`/`startScreenTrace` はAndroid専用でハードウェアアクセラレーション無効時に例外を投げるため、
 * iOS/Android両方で安定して動く通常のカスタムトレース(trace)を使う。
 *
 * #1016 【設計】区間をマウント〜アンマウントではなくfocus〜blurにする。
 * タブ切り替えでは React Navigation の画面はアンマウントされず、`(tabs)/_layout.tsx` にも
 * unmountOnBlur 相当の設定がないため、マウント基準だと一度開いた各タブのトレースが
 * タブナビゲータ破棄まで並行して走り続け、収集値が画面滞在時間ではなくセッション長に近くなる。
 * Stack で別画面に覆われた場合（search の index が dishCategories の背後に残るケース）も同様にblurで停止する。
 *
 * Web版は useScreenTrace.web.ts のno-op実装に差し替わる（#957のWeb RUMで計測基盤は完結済みのため）。
 *
 * @param screenName トレース名に使う画面識別子（例: "DishCategories"）
 */
export function useScreenTrace(screenName: string): void {
	useFocusEffect(
		useCallback(() => {
			const performanceTrace = trace(getPerformance(), `${SCREEN_TRACE_PREFIX}${screenName}`);
			// 計測はベストエフォートのため、SDK初期化前などの失敗で画面表示を妨げないようcatchで握りつぶす。
			const startPromise = performanceTrace.start().catch(() => {});

			return () => {
				// start完了前にblurした場合でもstopを取りこぼさないよう、開始完了を待ってから停止する。
				void startPromise.then(() => performanceTrace.stop()).catch(() => {});
			};
		}, [screenName]),
	);
}
