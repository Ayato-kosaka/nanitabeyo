import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { useCallback, useEffect, useRef, useState } from "react";

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
 * #1234 【設計】ヘルスチェック失敗のログレベルを決める。
 *
 * 【バグ】catch が `error_level: "error"` 固定だったため、**サーバーに届いてすらいない失敗**
 * （地下鉄・機内モード・電波が細い等の回線起因）まで error として記録され、
 * error-triage が毎日 Issue を起票していた。同じ意味の失敗でも
 * `api_call_error` の方は SQL の除外ルール E3 `client_network`（status = 0）で既に落ちており、
 * 「イベント名が違うだけで片方は除外・片方は起票」という不整合になっていた。
 *
 * 【修正】**HTTP ステータスを伴わないネットワーク失敗だけ** warn へ落とす。
 * `useAPICall` が `code: "network_error", status: 0` を投げるのはレスポンスが 1 度も
 * 返らなかったとき（タイムアウト 30s / fetch 自体の失敗）だけなので、この 2 条件で一意に判別できる。
 *
 * ⚠️ 一律 warn 化は絶対にしないこと。このコンポーネントは
 * **メンテナンスモード(503) と強制アップデート(426) をアプリが知る唯一の経路**であり
 * （フロントは Remote Config の `is_maintenance` / `minimum_supported_version` を読んでいない）、
 * その 2 つが検知できなくなったことに気付ける手段がヘルスチェックの error ログしか無い。
 * 503/426/その他の HTTP エラーは error のまま残す。
 *
 * ⚠️ `unauthenticated`（トークン未確立）もここでは触らない。error のままで良い。
 * こちらは SQL 側の除外ルール E2 `unauthenticated_race` で既に起票対象から外れており、
 * アプリ側でも下げると同じ事象への二重対応になる。
 */
export const resolveHealthCheckErrorLevel = (error: unknown): "warn" | "error" => {
	const apiError = error as ApiError | undefined;
	const hasHttpStatus = typeof apiError?.status === "number" && apiError.status > 0;
	return apiError?.code === "network_error" && !hasHttpStatus ? "warn" : "error";
};

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
	const { user } = useAuth();
	const [state, setState] = useState<HealthCheckState>({
		isChecking: false,
		hasCompleted: false,
		error: null,
	});

	// #1092 【設計】実行中/完了済みの判定は state ではなく ref で持つ。
	// state 経由だと performHealthCheck の identity が状態遷移のたびに変わり、
	// 「auth 解決後に 1 回だけ再試行する」下の effect が state の更新で誤発火する。
	const isCheckingRef = useRef(false);
	const hasCompletedRef = useRef(false);
	/** 直前の試行が「トークンが無いだけ」で失敗したか（= auth の解決を待てば成功しうる） */
	const needsAuthRetryRef = useRef(false);
	/** auth 解決後の再試行を使ったか。再試行は 1 回だけで、失敗しても自分自身を再予約しない */
	const hasRetriedAfterAuthRef = useRef(false);

	/**
	 * ヘルスチェックを実行する関数
	 */
	const performHealthCheck = useCallback(async () => {
		if (isCheckingRef.current || hasCompletedRef.current) {
			return;
		}

		isCheckingRef.current = true;
		setState((prev) => ({ ...prev, isChecking: true, error: null }));

		try {
			await callBackend<{}, HealthData>("health", {
				method: "GET",
				requestPayload: {},
			});

			hasCompletedRef.current = true;
			needsAuthRetryRef.current = false;
			setState((prev) => ({
				...prev,
				isChecking: false,
				hasCompleted: true,
				error: null,
			}));
		} catch (error: any) {
			logFrontendEvent({
				event_name: "health_check_error",
				// #1234 回線起因（レスポンス無し）だけ warn。503/426/その他は error のまま。
				// 判定理由は resolveHealthCheckErrorLevel の JSDoc を参照
				error_level: resolveHealthCheckErrorLevel(error),
				payload: {
					error: toErrorLogMessage(error),
					code: error?.code,
					status: error?.status,
					requestId: error?.requestId,
				},
			});

			// #1092 【修正】認証がまだ確立しておらずトークンが無かっただけの失敗を「完了」にしない。
			// ここで hasCompleted を立てると、その起動ではヘルスチェックが二度と走らず、
			// **メンテナンスモード(503)と強制アップデート(426)の検知が丸ごとスキップされる**。
			// 完了扱いにせず、下の effect が auth の解決を待って 1 回だけ叩き直す。
			if (error?.code === "unauthenticated") {
				needsAuthRetryRef.current = true;
				setState((prev) => ({
					...prev,
					isChecking: false,
					hasCompleted: false,
					error: "unauthenticated",
				}));
				return;
			}

			hasCompletedRef.current = true;

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
		} finally {
			isCheckingRef.current = false;
		}
	}, [logFrontendEvent, callBackend]);

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

	/**
	 * #1092 auth の解決（= セッションが手に入った）で 1 回だけ叩き直す。
	 *
	 * ループしないことの保証:
	 * 1. トークン欠如で失敗したとき（needsAuthRetryRef）にしか動かない
	 * 2. 再試行は 1 回だけ（hasRetriedAfterAuthRef）
	 * 3. 発火源は user の変化（= 外部起点の認証イベント）だけで、この処理は user を変化させない
	 */
	useEffect(() => {
		if (!user) return;
		if (!needsAuthRetryRef.current) return;
		if (hasRetriedAfterAuthRef.current) return;

		hasRetriedAfterAuthRef.current = true;
		needsAuthRetryRef.current = false;
		void performHealthCheck();
	}, [user?.id, performHealthCheck]);

	// デバッグ用（開発環境でのみ表示）
	useEffect(() => {
		// const { isChecking, hasCompleted, error } = state;
		// if (__DEV__) {
		// 	console.log("[HealthCheck] Status:", { isChecking, hasCompleted, error });
		// }
	}, [state]);

	// 画面描画は常に続行（ヘルスチェックは非同期）
	return <>{children}</>;
};
