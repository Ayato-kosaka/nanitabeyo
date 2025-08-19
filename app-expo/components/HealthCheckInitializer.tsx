import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useCallback, useEffect, useState } from "react";

interface HealthCheckState {
	isChecking: boolean;
	hasCompleted: boolean;
	error: string | null;
}

interface HealthData {
	status: "ok";
	timestamp: string;
}

/**
 * HealthCheckInitializer
 *
 * アプリ起動時にヘルスチェックを実行する軽量コンポーネント
 * - 画面描画を妨げない
 * - プロバイダ初期化後に実行
 */
export const HealthCheckInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const [state, setState] = useState<HealthCheckState>({
		isChecking: false,
		hasCompleted: false,
		error: null,
	});

	/**
	 * ヘルスチェックを実行する関数
	 */
	const performHealthCheck = useCallback(async () => {
		if (state.isChecking || state.hasCompleted) {
			return;
		}

		setState((prev) => ({ ...prev, isChecking: true, error: null }));

		try {
			logFrontendEvent({
				event_name: "health_check_started",
				error_level: "debug",
				payload: {},
			});

			await callBackend<{}, HealthData>("health", {
				method: "GET",
				requestPayload: {},
			});

			logFrontendEvent({
				event_name: "health_check_success",
				error_level: "log",
				payload: {},
			});

			setState((prev) => ({
				...prev,
				isChecking: false,
				hasCompleted: true,
				error: null,
			}));
		} catch (error: any) {
			logFrontendEvent({
				event_name: "health_check_error",
				error_level: "error",
				payload: {
					error: String(error),
					code: error?.code,
					status: error?.status,
					requestId: error?.requestId,
				},
			});

			// callBackend内で既にダイアログ表示等の処理が行われているため、
			// ここではエラー状態の設定のみを行う
			if (error?.code === "maintenance_mode") {
				setState((prev) => ({
					...prev,
					isChecking: false,
					hasCompleted: true,
					error: "maintenance_mode",
				}));
			} else if (error?.code === "unsupported_version") {
				setState((prev) => ({
					...prev,
					isChecking: false,
					hasCompleted: true,
					error: "unsupported_version",
				}));
			} else {
				setState((prev) => ({
					...prev,
					isChecking: false,
					hasCompleted: true,
					error: error?.code || "network_error",
				}));
			}
		}
	}, [state.isChecking, state.hasCompleted, logFrontendEvent, callBackend]);

	/**
	 * 起動時にヘルスチェックを自動実行
	 */
	useEffect(() => {
		// 少し遅延させて画面描画を優先
		const timeoutId = setTimeout(() => {
			performHealthCheck();
		}, 100);

		return () => clearTimeout(timeoutId);
	}, []);

	// デバッグ用（開発環境でのみ表示）
	useEffect(() => {
		const { isChecking, hasCompleted, error } = state;
		if (__DEV__) {
			console.log("[HealthCheck] Status:", { isChecking, hasCompleted, error });
		}
	}, [state]);

	// 画面描画は常に続行（ヘルスチェックは非同期）
	return <>{children}</>;
};
