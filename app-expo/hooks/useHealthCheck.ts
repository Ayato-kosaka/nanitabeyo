import { useCallback, useEffect, useState } from "react";
import { Env } from "@/constants/Env";
import { useLogger } from "./useLogger";
import { useDialog } from "@/contexts/DialogProvider";
import { Linking, Platform } from "react-native";
import i18n from "@/lib/i18n";

interface HealthCheckState {
	isChecking: boolean;
	hasCompleted: boolean;
	error: string | null;
}

/**
 * 🏥 ヘルスチェックフック
 * 
 * アプリ起動時に `/health` を非同期で呼び出し、
 * 503/426 エラーの場合は適切なダイアログを表示する
 */
export const useHealthCheck = () => {
	const { logFrontendEvent } = useLogger();
	const { showDialog } = useDialog();
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

		setState(prev => ({ ...prev, isChecking: true, error: null }));

		try {
			logFrontendEvent({
				event_name: "health_check_started",
				error_level: "debug",
				payload: {},
			});

			const response = await fetch(`${Env.BACKEND_BASE_URL}/health`, {
				method: "GET",
				headers: {
					"x-app-version": Env.APP_VERSION,
					"Content-Type": "application/json",
				},
			});

			const requestId = response.headers.get("x-request-id");

			if (response.ok) {
				logFrontendEvent({
					event_name: "health_check_success",
					error_level: "log",
					payload: {
						status: response.status,
						requestId,
					},
				});

				setState(prev => ({
					...prev,
					isChecking: false,
					hasCompleted: true,
					error: null,
				}));
			} else {
				// エラーレスポンスの処理
				let errorPayload: { error?: string; message?: string; errorCode?: string } = {};
				try {
					errorPayload = await response.json();
				} catch {
					// JSONパースエラーは無視
				}

				logFrontendEvent({
					event_name: "health_check_error",
					error_level: "error",
					payload: {
						status: response.status,
						requestId,
						errorCode: errorPayload.errorCode,
						errorMessage: errorPayload.message,
					},
				});

				// ステータスコード別の処理
				if (response.status === 503) {
					// メンテナンスモード
					showDialog(i18n.t("Error.maintenanceMessage"), {
						okLabel: i18n.t("Common.ok"),
						onConfirm: () => {
							// ダイアログを閉じてもアプリは操作不可状態を維持
						},
					});

					setState(prev => ({
						...prev,
						isChecking: false,
						hasCompleted: true,
						error: "maintenance_mode",
					}));
				} else if (response.status === 426) {
					// 強制アップデート
					const storeUrl = Platform.select({
						ios: Env.APP_STORE_URL,
						android: Env.PLAY_STORE_URL,
					});

					showDialog(i18n.t("Error.unsupportedVersion"), {
						okLabel: i18n.t("Common.goStore"),
						onConfirm: () => {
							if (storeUrl) {
								Linking.openURL(storeUrl);
							}
						},
					});

					setState(prev => ({
						...prev,
						isChecking: false,
						hasCompleted: true,
						error: "unsupported_version",
					}));
				} else {
					// その他のエラー
					setState(prev => ({
						...prev,
						isChecking: false,
						hasCompleted: true,
						error: `http_error_${response.status}`,
					}));
				}
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "health_check_network_error",
				error_level: "error",
				payload: {
					error: String(error),
				},
			});

			setState(prev => ({
				...prev,
				isChecking: false,
				hasCompleted: true,
				error: "network_error",
			}));
		}
	}, [state.isChecking, state.hasCompleted, logFrontendEvent, showDialog]);

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

	return {
		isChecking: state.isChecking,
		hasCompleted: state.hasCompleted,
		error: state.error,
		performHealthCheck,
	};
};