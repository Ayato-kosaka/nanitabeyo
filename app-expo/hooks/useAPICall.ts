import { useCallback } from "react";
import { Env } from "@/constants/Env";
import { useLogger } from "./useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import i18n from "@/lib/i18n";
import { useDialog } from "@/contexts/DialogProvider";
import { Linking, Platform } from "react-native";
import type { BaseResponse } from "@shared/api/v1/res";

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
	const { getSession } = useAuth();

	const buildRequestBody = <TRequest extends Record<string, any> | FormData>(
		method: "GET" | "POST" | "DELETE",
		shouldUseQuery: boolean,
		isMultipart: boolean,
		requestPayload: TRequest,
	): BodyInit | undefined => {
		if (method === "POST") {
			return isMultipart ? (requestPayload as FormData) : JSON.stringify(requestPayload);
		}
		if (method === "DELETE") {
			if (shouldUseQuery) {
				return undefined;
			}
			return isMultipart ? (requestPayload as FormData) : JSON.stringify(requestPayload);
		}
		return undefined;
	};

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
				method?: "GET" | "POST" | "DELETE";
				requestPayload: TRequest;
				isMultipart?: boolean;
			},
		): Promise<R> => {
			const appVersion = Env.APP_VERSION;
			// GET/DELETE で FormData でも multipart でもない場合はクエリに展開
			const shouldUseQuery =
				(method === "GET" || method === "DELETE") && !(requestPayload instanceof FormData) && !isMultipart;
			const qs = shouldUseQuery ? `?${new URLSearchParams(requestPayload as Record<string, string>).toString()}` : "";
			const endpoint = `${Env.BACKEND_BASE_URL}/${endpointName}${qs}`;

			// 🔐 認証トークンの有無をチェック
			const accessToken = getSession()?.access_token;
			if (!accessToken) {
				throw new Error("User is not authenticated: Supabase access_token is missing.");
			}

			// 🧾 リクエストヘッダー構築
			const headers: Record<string, string> = {
				"x-app-version": appVersion,
				Authorization: `Bearer ${accessToken}`,
			};
			const willSendBody = method === "POST" || (method === "DELETE" && !shouldUseQuery);
			if (willSendBody && !isMultipart) {
				headers["Content-Type"] = "application/json";
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

			const response = await fetch(endpoint, {
				method,
				headers,
				body: buildRequestBody(method, shouldUseQuery, isMultipart, requestPayload),
				// Include credentials for web to receive CDN signed cookies
				credentials: Platform.OS === "web" ? "include" : "same-origin",
			});

			const requestId = response.headers.get("x-request-id");
			const duration = Date.now() - startTime;

			// ❌ エラー処理
			if (!response.ok) {
				const errorMessage = `API call to ${endpointName} failed with status ${response.status} (requestId: ${requestId})`;

				let errorPayload: { error?: string; message?: string } = {};
				try {
					errorPayload = await response.json();
				} catch {
					// レスポンスボディがJSONでない場合はスキップ
				}

				// Log API error
				logFrontendEvent({
					event_name: "api_call_error",
					error_level: "error",
					payload: {
						endpoint: endpointName,
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
						message: errorPayload.message || errorMessage,
						requestId,
					};
				}

				if (response.status === 426) {
					// 強制アップデート (HTTP 426 Upgrade Required)
					const storeUrl = Platform.select({
						ios: Env.APP_STORE_URL,
						android: Env.PLAY_STORE_URL,
					});
					showDialog(i18n.t("Error.unsupportedVersion"), {
						okLabel: i18n.t("Common.goStore"),
						onConfirm: () => storeUrl && Linking.openURL(storeUrl),
					});
					throw {
						code: "unsupported_version",
						message: errorPayload.message || errorMessage,
						requestId,
					};
				}

				// 既存の403エラー処理（後方互換性のため残す）
				if (response.status === 403) {
					throw {
						code: "forbidden",
						message: errorPayload.message || errorMessage,
						requestId,
					};
				}

				// その他の HTTP エラー
				throw {
					code: "http_error",
					status: response.status,
					message: `API call to ${endpointName} failed with status ${response.status}`,
					requestId,
				};
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
					requestId,
					status: response.status,
				};
			}

			if (!json || typeof json !== "object" || typeof json.success !== "boolean") {
				throw {
					code: "invalid_response",
					message: `Malformed response for ${endpointName}`,
					requestId,
					status: response.status,
				};
			}

			if (!json.success) {
				throw {
					code: "api_error",
					message: json.message || `API returned unsuccessful response for ${endpointName}`,
					errorCode: json.errorCode,
					requestId,
					status: response.status,
				};
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
		[logFrontendEvent, getSession, showDialog],
	);

	return { callBackend };
};
