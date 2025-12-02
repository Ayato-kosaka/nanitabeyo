import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as SplashScreen from "expo-splash-screen";
import { useAuth } from "@/contexts/AuthProvider";
import { initRemoteConfig } from "@/lib/remoteConfig";
import { Env } from "@/constants/Env";
import { retry } from "@/lib/retry";

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
	const { loading: isAuthLoading, user } = useAuth();

	const [isRemoteConfigReady, setIsRemoteConfigReady] = useState(false);
	const hasSplashBeenHiddenRef = useRef(false);

	/**
	 * 🔧 Remote Config の初期化処理
	 */
	const initializeRemoteConfig = useCallback(async () => {
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
			if (Env.NODE_ENV === "development") {
				console.error("[SplashHandler] RemoteConfig initialization failed:", err);
			}
		} finally {
			setIsRemoteConfigReady(true);
		}
	}, []);

	/**
	 * 🎬 Splash 非表示ロジック
	 * - 一度だけ実行されるようフラグで制御
	 */
	const hideSplashScreenIfReady = useCallback(async () => {
		if (!isAuthLoading && user && !hasSplashBeenHiddenRef.current) {
			try {
				await SplashScreen.hideAsync();
				hasSplashBeenHiddenRef.current = true;
			} catch (err: any) {
				if (Env.NODE_ENV === "development") {
					console.warn("[SplashHandler] Failed to hide splash screen:", err.message);
				}
			}
		}
	}, [isAuthLoading, user]);

	// 初期化実行（on mount）
	useEffect(() => {
		initializeRemoteConfig();
	}, [initializeRemoteConfig]);

	// Splash 非表示条件を監視して実行
	useEffect(() => {
		hideSplashScreenIfReady();
	}, [isAuthLoading, user, hideSplashScreenIfReady]);

	/**
	 * 📌 アプリ起動に必要な要件がすべて満たされているか
	 */
	const isAppReady = useMemo(() => {
		return isRemoteConfigReady && !isAuthLoading && !!user;
	}, [isRemoteConfigReady, isAuthLoading, user]);

	if (!isAppReady) return null;

	return <>{children}</>;
};
