import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as SplashScreen from "expo-splash-screen";
import { useAuth } from "@/contexts/AuthProvider";
import { getRemoteConfigSource, initRemoteConfig } from "@/lib/remoteConfig";
import { Env } from "@/constants/Env";
import { retry } from "@/lib/retry";
import { AuthErrorFallback } from "@/components/AuthErrorFallback";
import { useLogger } from "@/hooks/useLogger";

/**
 * 🧯 アプリ起動時の Splash 画面を制御するコンポーネント。
 *
 * - Remote Config の初期化と Supabase 認証状態（匿名ログイン含む）の確定を待つ
 * - すべての準備が完了した時点で Splash を非表示にし、アプリ本体を表示
 * - 初回起動ログやエラー情報も適切に記録する
 *
 * @param children - アプリのメイン画面（準備完了後に表示される）
 * @returns JSX構造
 */
export const SplashHandler = ({ children }: { children: React.ReactNode }) => {
	const { loading: isAuthLoading, user, authError, retryAuth, isRetryingAuth } = useAuth();
	const { logFrontendEvent } = useLogger();

	const [isRemoteConfigReady, setIsRemoteConfigReady] = useState(false);
	const hasSplashBeenHiddenRef = useRef(false);
	const hasLoggedRemoteConfigSourceRef = useRef(false);

	/**
	 * 🔧 Remote Config の初期化処理
	 */
	const initializeRemoteConfig = useCallback(async () => {
		let initError: unknown;
		try {
			await retry(() => initRemoteConfig(), {
				retries: 3,
				initialDelayMs: 500,
				backoffFactor: 2,
				shouldRetry: (error) => {
					// 必要ならここでリトライ対象のエラーを絞り込む
					// 例: ネットワークエラーのみリトライなど
					if (Env.NODE_ENV === "development") {
						console.warn("[SplashHandler] RemoteConfig retry due to error:", error);
					}
					return true;
				},
			});
		} catch (err: any) {
			initError = err;
			if (Env.NODE_ENV === "development") {
				console.error("[SplashHandler] RemoteConfig initialization failed:", err);
			}
		} finally {
			// #1092 値の出所（default / network）を残す。既定値をアプリへ埋め込んだことで
			// 「CDN へ到達できないまま古い既定値で動き続ける端末」が生まれうるため、
			// その割合を後から BigQuery で追えるようにしておく。
			//
			// ⚠️ ログ送信は必ずここ（= ログ経路の外側）で行うこと。`lib/remoteConfig.ts` の中で
			//    logFrontendEvent を呼ぶと、hooks/useLogger.ts が閾値判定で getRemoteConfig() を
			//    読んでいるため相互再帰になる（#1079 の logQueue と同じ規律）。
			if (!hasLoggedRemoteConfigSourceRef.current) {
				hasLoggedRemoteConfigSourceRef.current = true;
				logFrontendEvent({
					event_name: "remote_config_resolved",
					error_level: initError ? "warn" : "log",
					payload: {
						source: getRemoteConfigSource(),
						// 取得に失敗した場合のみ、原因の手掛かりとしてメッセージだけ残す
						error_message: initError instanceof Error ? initError.message : undefined,
					},
				});
			}
			setIsRemoteConfigReady(true);
		}
	}, [logFrontendEvent]);

	/**
	 * 🎬 Splash 非表示ロジック
	 * - 一度だけ実行されるようフラグで制御
	 *
	 * #1089 【バグ】条件が `user` だけだったため、匿名サインインが失敗した端末では
	 * hideAsync() が永久に呼ばれず、native はスプラッシュが張り付いたままになっていた
	 * （web の空画面と同じ根本原因・別症状）。認証が「確立できなかった」と確定した場合も
	 * 必ず解除し、下のエラー UI をユーザーへ見せる。
	 */
	const hideSplashScreenIfReady = useCallback(async () => {
		const isAuthSettled = !isAuthLoading && (!!user || !!authError);
		if (isAuthSettled && !hasSplashBeenHiddenRef.current) {
			try {
				await SplashScreen.hideAsync();
				hasSplashBeenHiddenRef.current = true;
			} catch (err: any) {
				if (Env.NODE_ENV === "development") {
					console.warn("[SplashHandler] Failed to hide splash screen:", err.message);
				}
			}
		}
	}, [isAuthLoading, user, authError]);

	// 初期化実行（on mount）
	useEffect(() => {
		initializeRemoteConfig();
	}, [initializeRemoteConfig]);

	// Splash 非表示条件を監視して実行
	useEffect(() => {
		hideSplashScreenIfReady();
	}, [isAuthLoading, user, authError, hideSplashScreenIfReady]);

	/**
	 * 📌 アプリ起動に必要な要件がすべて満たされているか
	 */
	const isAppReady = useMemo(() => {
		return isRemoteConfigReady && !isAuthLoading && !!user;
	}, [isRemoteConfigReady, isAuthLoading, user]);

	// #1089 認証が確立できないまま確定した場合は、null を返し続けて空画面のまま放置せず、
	// 「失敗した」ことと再試行手段をユーザーへ提示する。
	// ⚠️ isAppReady の `!!user` ゲートそのもの（認証前でも UI を先に出す設計）は #1092 のスコープなので触らない。
	//    Remote Config は失敗しても必ず ready になるため、ここでは待たずにエラー UI を優先する。
	if (!isAuthLoading && !user && authError) {
		return <AuthErrorFallback isRateLimited={authError.isRateLimited} isRetrying={isRetryingAuth} onRetry={retryAuth} />;
	}

	if (!isAppReady) return null;

	return <>{children}</>;
};
