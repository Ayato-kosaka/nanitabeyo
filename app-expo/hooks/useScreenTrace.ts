import { useEffect } from "react";
import { getPerformance, trace } from "@react-native-firebase/perf";

const SCREEN_TRACE_PREFIX = "screen_";

/**
 * #1016 【設計】画面のマウント〜アンマウントをFirebase Performance Monitoringのカスタムトレースとして計測する。
 * `newScreenTrace`/`startScreenTrace` はAndroid専用でハードウェアアクセラレーション無効時に例外を投げるため、
 * iOS/Android両方で安定して動く通常のカスタムトレース(trace)をマウント期間の計測に使う。
 * Web版は useScreenTrace.web.ts のno-op実装に差し替わる（#957のWeb RUMで計測基盤は完結済みのため）。
 *
 * @param screenName トレース名に使う画面識別子（例: "Topics"）
 */
export function useScreenTrace(screenName: string): void {
	useEffect(() => {
		const performanceTrace = trace(getPerformance(), `${SCREEN_TRACE_PREFIX}${screenName}`);
		// 計測はベストエフォートのため、SDK初期化前などの失敗で画面表示を妨げないようcatchで握りつぶす。
		performanceTrace.start().catch(() => {});

		return () => {
			performanceTrace.stop().catch(() => {});
		};
	}, [screenName]);
}
