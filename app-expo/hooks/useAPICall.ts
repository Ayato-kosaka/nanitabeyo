import { useCallback } from "react";
import { Env } from "@/constants/Env";
import { useLogger } from "./useLogger";
import { useAuth } from "@/contexts/AuthProvider";
import i18n from "@/lib/i18n";
import { useDialog } from "@/contexts/DialogProvider";
import { Platform } from "react-native";
import { ErrorCode, type BaseResponse } from "@shared/api/v1/res";
import { useCdnCookieStore } from "@/stores/useCdnCookieStore";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { openExternalUrl } from "@/lib/openExternalUrl";

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
		| "network_error"
		/**
		 * #1092 認証がまだ確立していないため JWT を付けられず、リクエストを送っていない状態。
		 * サーバーに届いた上での 401 ではなく「今は呼べない」なので、呼び出し側は
		 * **auth の解決後に 1 回だけ再試行する**という判断ができる（できなければならない）。
		 */
		| "unauthenticated"
		/**
		 * #1629 呼び出し側が `signal` で **自分から打ち切った**状態。
		 *
		 * 通信の失敗ではないので、スナックバーもエラーログも出してはいけない。
		 * 地図の viewport が変わって前の検索が要らなくなった、のような «正常な取り消し» に使う。
		 */
		| "aborted";

	/** HTTP ステータス。ネットワークエラー等の場合は undefined or 0 */
	status?: number;

	/**
	 * #1629 **30 秒（API_CALL_TIMEOUT_MS）待っても応答が来ずに中断した**とき true。
	 *
	 * `code` は "network_error" のままにしてある（分類コードを増やすと、既存の
	 * すべての分岐に «知らない code» が流れ込む）。呼び出し側が «圏外・回線断» と
	 * «サーバが遅い» を別の文言で出したいときだけ、この 1 つを見れば足りる。
	 *
	 * ⚠️ ユーザーから見ると両者はまったく違う。圏外なら «電波» を疑うべきだが、
	 *    タイムアウトは端末側で打てる手が «範囲を狭めてもう一度» しか無い。
	 *    ここを潰して «通信に失敗しました» にまとめると、地図が黙って空になる
	 *    （オーナーが実機で踏んだ #1629 の症状そのもの）。
	 */
	timedOut?: boolean;

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

// #940 【設計】応答が返らないまま無期限に待ち続ける(=ユーザーがローディング画面に留まり続ける)のを
// 防ぐためのタイムアウト。リトライを含む呼び出し全体で共有する(各試行ごとにリセットはしない)
const API_CALL_TIMEOUT_MS = 30_000;

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
	const { getSession, refreshSession, waitForAuthResolved } = useAuth();

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
				signal,
			}: {
				method?: "GET" | "POST" | "PATCH" | "DELETE";
				requestPayload: TRequest;
				isMultipart?: boolean;
				/**
				 * #1629 呼び出し側からの中断。**飛んでいるリクエストを実際に止める**ための口。
				 *
				 * 地図のように «次の操作で前の結果が要らなくなる» 画面では、応答を捨てるだけでは
				 * サーバ側の集計クエリが全部走り切る。ここへ `AbortController.signal` を渡すと、
				 * 内部のタイムアウト用 controller と連動して fetch ごと中断し、
				 * `code: "aborted"` の `ApiError` を投げる（リトライもしない）。
				 */
				signal?: AbortSignal;
			},
		): Promise<R> => {
			// 🔐 認証トークンの有無をチェック
			let accessToken = getSession()?.access_token;

			// #1194 【設計】トークンが無いとき、**まず認証初期化の決着を待つ**。
			//
			// ## 実機で踏んだ症状
			// LINE から投票の共有リンクを開くと «時々だけ» 「結果を取得できませんでした」になり、
			// 再試行すると成功する、という報告があった。ディープリンク起動では
			// 画面のマウントと匿名サインインが競合し、画面が先に走ることがある。
			// 従来はここで即 throw していたため、**あと数百ミリ秒待てば成功する呼び出しまで失敗**にしていた。
			//
			// ⚠️ この待機は «トークンが無いときだけ»。通常の呼び出し（既にセッションがある）は
			// 一切待たない。ここに無条件の await を置くと全 API 呼び出しが 1 tick 遅くなる。
			//
			// ⚠️ 認証が最終的に失敗している場合、`loading` は既に false なので待機は即座に返り、
			// 従来どおり `unauthenticated` を投げる。**「待てば直る」と「壊れている」を混ぜない**
			if (!accessToken) {
				await waitForAuthResolved();
				accessToken = getSession()?.access_token;
			}

			if (!accessToken) {
				// #1092 【設計】ここは JWT を要求する全経路の単一チョークポイント。
				// 素の Error を投げていたため、呼び出し側の `error?.code` が undefined になり、
				// 全呼び出し元が「原因不明のエラー」として扱っていた（= 後で再試行すべきなのか、
				// 恒久的な失敗なのかを区別できない）。ApiError に揃えて判断材料を渡す。
				// status は付けない: リクエストを送っていないので、対応する HTTP ステータスが存在しない。
				throw {
					code: "unauthenticated",
					message: `User is not authenticated: Supabase access_token is missing (endpoint: ${endpointName}).`,
				} satisfies ApiError;
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
			// #940 【設計】リトライを含む呼び出し全体で1つの AbortController を共有し、
			// 30秒応答が無ければ中断して network_error として分類する
			let response: Response | undefined;
			let endpoint = endpointName;
			let networkError: unknown;
			let didTimeout = false;
			const abortController = new AbortController();
			const timeoutId = setTimeout(() => {
				didTimeout = true;
				abortController.abort();
			}, API_CALL_TIMEOUT_MS);
			// #1629 外からの中断。タイムアウトと同じ controller を叩き、リトライにも入らせない
			let didAbort = false;
			const handleExternalAbort = () => {
				didAbort = true;
				abortController.abort();
			};
			if (signal) {
				if (signal.aborted) handleExternalAbort();
				else signal.addEventListener("abort", handleExternalAbort);
			}

			try {
				for (let attempt = 0; attempt < 2; attempt++) {
					response = undefined;
					try {
						const result = await fetchWithAuth(
							endpointName,
							{
								method,
								requestPayload,
								isMultipart,
								signal: abortController.signal,
							},
							accessToken,
						);
						response = result.response;
						endpoint = result.endpoint;
						networkError = undefined;
					} catch (error) {
						networkError = error;
						// #1629 呼び出し側が打ち切ったならリトライしない（再送は中断の意味を消す）
						if (didAbort) break;
						// タイムアウト後はリトライせず即座に打ち切る(既に応答期限を超過しているため)
						if (didTimeout) {
							logFrontendEvent({
								event_name: "api_call_timeout",
								error_level: "warn",
								payload: { endpoint: endpointName, method, timeoutMs: API_CALL_TIMEOUT_MS },
							});
							break;
						}
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
									error: toErrorLogMessage(error),
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
			} finally {
				clearTimeout(timeoutId);
				signal?.removeEventListener("abort", handleExternalAbort);
			}

			// #1629 中断は «失敗» ではない。ログもスナックバーも出さずに専用の code を投げる
			if (didAbort) {
				throw {
					code: "aborted",
					message: `Aborted by caller while calling ${endpointName}`,
				} satisfies ApiError;
			}

			if (!response) {
				logFrontendEvent({
					event_name: "api_call_error",
					error_level: "error",
					payload: {
						endpoint: endpointName,
						method,
						status: 0,
						error: toErrorLogMessage(networkError),
						timedOut: didTimeout,
					},
				});
				throw {
					code: "network_error",
					status: 0,
					message: didTimeout
						? `Network timeout (${API_CALL_TIMEOUT_MS}ms) while calling ${endpointName}`
						: `Network error while calling ${endpointName}`,
					// #1629 呼び出し側が «遅すぎた» と «繋がらなかった» を出し分けられるようにする
					timedOut: didTimeout,
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
				/*
				#1642 【バグ】ここは **HTTP 503 を丸ごとメンテナンス扱い**にしていた。

				503 を返すのは `MaintenanceGuard` だけではない。
				  - `DELETE /v1/users/me` — Supabase Auth のアカウント削除失敗（再送で完了できる）
				  - Cloud Run / LB の一時的な過負荷（そもそも errorPayload が我々のものではない）
				実際にオーナーの実機で「ただいまメンテナンス中です。」が出た（2026-08-31）。
				真因は Google Places の日次上限を 503 で返していたことで、そちらは
				`external-api.service.ts` を 429 へ戻して直した（#1642）。ただし
				**503 = メンテナンス という読み替え自体が誤り**なので、ここも直す。
				メンテナンスと名乗ると «全機能が止まっている・こちらが意図的に止めた» と読めるので、
				実際には検索の一部が失敗しただけの障害を誤って重大に見せてしまう。

				【修正】メンテナンスを名乗ってよいのは、Remote Config の `is_maintenance` を読んだ
				`MaintenanceGuard` が付ける `SERVICE_MAINTENANCE` が乗っているときだけにする。
				それ以外の 503 は下の汎用 HTTP エラー経路へ落とし、呼び出し側の
				「取得できなかった」表示（0 件・スナックバー等）に委ねる。
				*/
				if (response.status === 503 && backendErrorCode === ErrorCode.SERVICE_MAINTENANCE) {
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
								// #1121 外部遷移は openExternalUrl へ統一する。
								// storeUrl は Platform.select の ios/android のみなので Web では undefined
								void openExternalUrl(storeUrl);
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
		[logFrontendEvent, getSession, refreshSession, waitForAuthResolved, showDialog],
	);

	return { callBackend };
};
