import { useCallback } from "react";
import { Env } from "@/constants/Env";
import { useLogger } from "./useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import i18n from "@/lib/i18n";
import { useDialog } from "@/contexts/DialogProvider";
import { Linking, Platform } from "react-native";
import type { BaseResponse } from "@shared/api/v1/res";
import { useCdnCookieStore } from "@/stores/useCdnCookieStore";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

/**
 * #525 【設計】統一されたエラーオブジェクト型
 * useAPICall が throw するエラーの型を統一し、呼び出し側が扱いやすい形に整備
 */
export type ApiError = {
	/** クライアント側で使う大まかな分類コード */
	code:
	| "maintenance_mode"
	| "unsupported_version"
	| "forbidden"
	| "http_error"
	| "api_error"
	| "invalid_response"
	| "network_error";

	/** HTTP ステータス。ネットワークエラー等の場合は undefined or 0 */
	status?: number;

	/** 人間向け or ログ用メッセージ */
	message: string;

	/** バックエンドから返ってきた x-request-id（あれば） */
	requestId?: string;

	/**
	 * バックエンド独自の errorCode
	 * BaseResponse<R> の errorCode, あるいは非 2xx レスポンスの JSON の code 等をここに格納
	 * 例: "PLACE_NOT_FOOD_AND_DRINK"
	 */
	errorCode?: string;

	/** 必要があれば生のレスポンスや追加情報 */
	raw?: unknown;
};

/**
 * ☁️ API 呼び出しフック
 *
 * - 認証セッションの JWT を Authorization ヘッダーに付与
 * - multipart/form-data または JSON 形式の POST/DELETE に対応
 * - 呼び出しと同時にログを出力し、レスポンスを返す
 * - 通信エラー時はログ記録した上で例外をスロー
 *
 * @returns { callBackend } - API 呼び出し関数
 * @throws ネットワークエラー、認証なし・応答エラー時
 */
export const useAPICall = () => {
	const { logFrontendEvent } = useLogger();
	const { showDialog } = useDialog();
	const { getSession, refreshSession } = useAuth();

	/**
	 * 指定されたエンドポイントに対して API を呼び出す関数
	 *
	 * @param endpointName - エンドポイント名（例: "/v1/dish-categories/recommendations"）
	 * @param requestPayload - リクエストボディ（JSONまたはFormData）
	 * @param isMultipart - multipart/form-data を使用するか
	 * @returns {Promise<R>} - レスポンスデータ
	 * @throws ネットワークエラーまたは認証なし・応答エラー時に例外をスロー
	 */
	const callBackend = useCallback(
		async <TRequest extends Record<string, any> | FormData, R>(
			endpointName: string,
			{
				method = "POST",
				requestPayload,
				isMultipart = false,
			}: {
				method?: "GET" | "POST" | "PATCH" | "DELETE";
				requestPayload: TRequest;
				isMultipart?: boolean;
			},
		): Promise<R> => {
			// 🔐 認証トークンの有無をチェック
			let accessToken = getSession()?.access_token;
			if (!accessToken) {
				throw new Error("User is not authenticated: Supabase access_token is missing.");
			}

			// 🌐 API 呼び出し
			const startTime = Date.now();
			logFrontendEvent({
				event_name: "api_call_started",
				error_level: "debug",
				payload: {
					endpoint: endpointName,
					method,
					isMultipart,
					hasRequestPayload: !!requestPayload,
				},
			});

			// #897 リトライ上限は初回を含め2回に固定する。401・GETの一時障害が重なっても
			// API呼び出し単位で無制限に再送せず、最終失敗は従来どおり下の共通処理へ渡す。
			let response: Response | undefined;
			let endpoint = endpointName;
			let networkError: unknown;

			for (let attempt = 0; attempt < 2; attempt++) {
				response = undefined;
				try {
					const result = await fetchWithAuth(
						endpointName,
						{
							method,
							requestPayload,
							isMultipart,
						},
						accessToken,
					);
					response = result.response;
					endpoint = result.endpoint;
					networkError = undefined;
				} catch (error) {
					networkError = error;
					// 通信到達が不明なPOST等は重複作成を避ける。副作用のないGETだけを再送する。
					if (method === "GET" && attempt === 0) {
						logFrontendEvent({
							event_name: "api_call_retry",
							error_level: "warn",
							payload: { endpoint: endpointName, method, reason: "network_error" },
						});
						await new Promise((resolve) => setTimeout(resolve, 500));
						continue;
					}
					break;
				}

				// 自動refreshだけでは失敗済みリクエストは復旧しないため、新tokenで1回だけ再送する。
				// 401は認証段階で拒否された応答なので、POSTを含めても処理の二重実行にはならない。
				if (response.status === 401 && attempt === 0) {
					try {
						const refreshedSession = await refreshSession();
						if (!refreshedSession?.access_token) break;
						accessToken = refreshedSession.access_token;
						logFrontendEvent({
							event_name: "api_call_retry",
							error_level: "warn",
							payload: { endpoint: endpointName, method, reason: "session_refreshed_after_401" },
						});
						continue;
					} catch (error) {
						logFrontendEvent({
							event_name: "api_call_session_refresh_failed",
							error_level: "error",
							payload: {
								endpoint: endpointName,
								error: error instanceof Error ? error.message : String(error),
							},
						});
						break;
					}
				}

				// 503は一時的な過負荷でも返る。GETに限定し、Retry-Afterを最大5秒まで尊重する。
				if (response.status === 503 && method === "GET" && attempt === 0) {
					const retryAfterHeader = response.headers.get("retry-after");
					const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
					const retryDelayMs = Number.isFinite(retryAfterSeconds)
						? Math.min(Math.max(retryAfterSeconds * 1000, 0), 5000)
						: 500;
					logFrontendEvent({
						event_name: "api_call_retry",
						error_level: "warn",
						payload: { endpoint: endpointName, method, reason: "service_unavailable", retryDelayMs },
					});
					await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
					continue;
				}

				break;
			}

			if (!response) {
				logFrontendEvent({
					event_name: "api_call_error",
					error_level: "error",
					payload: {
						endpoint: endpointName,
						method,
						status: 0,
						error: networkError instanceof Error ? networkError.message : String(networkError),
					},
				});
				throw {
					code: "network_error",
					status: 0,
					message: `Network error while calling ${endpointName}`,
					raw: networkError,
				} satisfies ApiError;
			}

			// #501 【設計】CDN サインド Cookie をレスポンスヘッダから抽出してストアに保存
			if (response.headers.get("set-cookie")) {
				useCdnCookieStore.getState().setFromResponseHeaders(response.headers);
			}

			const requestId = response.headers.get("x-request-id");
			const duration = Date.now() - startTime;

			// ❌ エラー処理
			if (!response.ok) {
				const errorMessage = `API call to ${endpointName} failed with status ${response.status} (requestId: ${requestId})`;

				// #525 【設計】errorPayload の型を拡張し、バックエンドの code/errorCode を取得できるようにする
				let errorPayload: { error?: string; message?: string; code?: string; errorCode?: string } = {};
				try {
					errorPayload = await response.json();
				} catch {
					// レスポンスボディがJSONでない場合はスキップ
				}

				// #525 【設計】errorCode は errorPayload.errorCode を優先し、なければ errorPayload.code を使用
				const backendErrorCode = errorPayload.errorCode || errorPayload.code;

				// Log API error
				logFrontendEvent({
					event_name: "api_call_error",
					error_level: "error",
					payload: {
						endpoint,
						method,
						status: response.status,
						requestId,
						requestPayload: isMultipart ? "[multipart/form-data]" : requestPayload,
						errorPayload,
					},
				});

				// 特定ステータスコードによる分岐
				if (response.status === 503) {
					// メンテナンスモード (HTTP 503 Service Unavailable)
					showDialog(i18n.t("Error.maintenanceMessage"), {
						okLabel: i18n.t("Common.ok"),
						onConfirm: () => {
							// ダイアログを閉じてもアプリは操作不可状態を維持
						},
					});
					throw {
						code: "maintenance_mode",
						status: response.status,
						message: errorPayload.message || errorMessage,
						requestId: requestId ?? undefined,
						errorCode: backendErrorCode,
						raw: errorPayload,
					} satisfies ApiError;
				}

				if (response.status === 426) {
					// 強制アップデート (HTTP 426 Upgrade Required)
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
					throw {
						code: "unsupported_version",
						status: response.status,
						message: errorPayload.message || errorMessage,
						requestId: requestId ?? undefined,
						errorCode: backendErrorCode,
						raw: errorPayload,
					} satisfies ApiError;
				}

				// 既存の403エラー処理（後方互換性のため残す）
				if (response.status === 403) {
					throw {
						code: "forbidden",
						status: response.status,
						message: errorPayload.message || errorMessage,
						requestId: requestId ?? undefined,
						errorCode: backendErrorCode,
						raw: errorPayload,
					} satisfies ApiError;
				}

				// その他の HTTP エラー
				throw {
					code: "http_error",
					status: response.status,
					message: `API call to ${endpointName} failed with status ${response.status}`,
					requestId: requestId ?? undefined,
					errorCode: backendErrorCode,
					raw: errorPayload,
				} satisfies ApiError;
			}

			// 2xx のときのみここに到達
			// BaseResponse<R> を厳密にパースし、success=false は API レベルのエラーとして扱う
			let json: BaseResponse<R>;
			try {
				json = (await response.json()) as BaseResponse<R>;
			} catch (e) {
				throw {
					code: "invalid_response",
					message: `Failed to parse response JSON for ${endpointName}`,
					requestId: requestId ?? undefined,
					status: response.status,
				} satisfies ApiError;
			}

			if (!json || typeof json !== "object" || typeof json.success !== "boolean") {
				throw {
					code: "invalid_response",
					message: `Malformed response for ${endpointName}`,
					requestId: requestId ?? undefined,
					status: response.status,
				} satisfies ApiError;
			}

			if (!json.success) {
				throw {
					code: "api_error",
					message: json.message || `API returned unsuccessful response for ${endpointName}`,
					errorCode: json.errorCode,
					requestId: requestId ?? undefined,
					status: response.status,
					raw: json,
				} satisfies ApiError;
			}

			logFrontendEvent({
				event_name: "api_call_success",
				error_level: "log",
				payload: {
					endpoint: endpointName,
					method,
					requestId,
					duration,
					status: response.status,
					responsePayload: json,
				},
			});

			// data のみを返す
			return json.data;
		},
		[logFrontendEvent, getSession, refreshSession, showDialog],
	);

	return { callBackend };
};
