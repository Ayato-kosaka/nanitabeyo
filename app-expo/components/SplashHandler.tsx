import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as SplashScreen from "expo-splash-screen";
import { useAuth } from "@/contexts/AuthProvider";
import { initRemoteConfig } from "@/lib/remoteConfig";
import { Env } from "@/constants/Env";
import { retry } from "@/lib/retry";
import { AuthErrorFallback } from "@/components/AuthErrorFallback";

/**
 * 🧯 アプリ起動時の Splash 画面を制御するコンポーネント。
 *
 * - Remote Config の初期化を待つ（認証の確定は **待たない**。#1092 PR4b）
 * - 最初の描画が可能になった時点で Splash を非表示にし、アプリ本体を表示
 * - 初回起動ログやエラー情報も適切に記録する
 *
 * @param children - アプリのメイン画面（準備完了後に表示される）
 * @returns JSX構造
 */
export const SplashHandler = ({ children }: { children: React.ReactNode }) => {
	const { loading: isAuthLoading, user, authError, retryAuth, isRetryingAuth } = useAuth();

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
	 * 📌 アプリ本体（children）を描画してよいか。
	 *
	 * #1092 【修正】ここから `!isAuthLoading && !!user` を外した。
	 * 匿名サインインは起動のたびにネットワーク往復を伴い、回線が細い端末では秒単位で待つ。
	 * その間 `return null` していたため、**アプリは 1 ピクセルも描画されていなかった**
	 * （web は薄グレーの空画面、native はスプラッシュのまま）。
	 * 認証を必要とするのは API 呼び出しであって描画ではないので、UI は先に出す。
	 *
	 * ⚠️ この結果、children は `user === null` の状態でマウントされる。
	 *    その前提に耐えられるようにする作業は PR4a で先に済ませてある
	 *    （`useAPICall` の `code: "unauthenticated"`、`HealthCheckInitializer` /
	 *     `useAutoCurrentLocation` の auth 解決後 1 回だけの再試行、`LoginbackModal` の null ガード）。
	 *
	 * ⚠️ `isRemoteConfigReady` はまだ残す（外すのは #1092 PR3 のスコープ）。
	 *    Remote Config の初期化は失敗しても finally で必ず ready になるので、
	 *    ここが永久に false のまま止まることはない。
	 */
	const isAppReady = useMemo(() => isRemoteConfigReady, [isRemoteConfigReady]);

	/**
	 * #1089 認証が確立できないまま確定した状態。children ではなくエラー UI を出す。
	 * Remote Config の完了は待たない（待つとエラーの提示が遅れるだけ）。
	 */
	const isAuthUnavailable = !isAuthLoading && !user && !!authError;

	/**
	 * 📌 「何かを描画できる状態」か。これが Splash を解除してよいタイミングと一致する。
	 *
	 * 下の描画分岐（エラー UI / children / null）と 1 対 1 で対応させること。
	 * ここが描画分岐より **緩い**と真っ白な画面が見え、**厳しい**と描画済みなのにスプラッシュが被る。
	 */
	const canRenderFirstFrame = isAppReady || isAuthUnavailable;

	/**
	 * 🎬 Splash 非表示ロジック
	 * - 一度だけ実行されるようフラグで制御
	 *
	 * #1092 【修正】条件を「認証が確定したか」から「最初のフレームを描画できるか」へ変えた。
	 * ゲートを外して UI を先に出すようにした以上、スプラッシュも同じ時点で解除しないと、
	 * 描画できているのにスプラッシュに隠されたままになり、この PR の効果が丸ごと消える。
	 *
	 * #1089 【非退行】どの経路でも必ず一度は hideAsync() が呼ばれること。
	 * 以前は条件が `user` だけだったため、匿名サインインが失敗した端末では hideAsync() が
	 * 永久に呼ばれず、native はスプラッシュが張り付いたままになっていた。
	 * 今の条件は `isRemoteConfigReady`（initializeRemoteConfig の finally で必ず true になる）を
	 * 含むので、認証がどうなろうと解除される。**認証の状態を必須条件に戻さないこと。**
	 */
	const hideSplashScreenIfReady = useCallback(async () => {
		if (canRenderFirstFrame && !hasSplashBeenHiddenRef.current) {
			// hideAsync() の解決を待たずにフラグを立てる。await の間に再レンダリングが挟まると
			// 二重に hideAsync() を呼んでしまうため（失敗時は下の catch で戻す）
			hasSplashBeenHiddenRef.current = true;
			try {
				await SplashScreen.hideAsync();
			} catch (err: any) {
				hasSplashBeenHiddenRef.current = false;
				if (Env.NODE_ENV === "development") {
					console.warn("[SplashHandler] Failed to hide splash screen:", err?.message ?? err);
				}
			}
		}
	}, [canRenderFirstFrame]);

	// 初期化実行（on mount）
	useEffect(() => {
		initializeRemoteConfig();
	}, [initializeRemoteConfig]);

	// Splash 非表示条件を監視して実行
	useEffect(() => {
		hideSplashScreenIfReady();
	}, [hideSplashScreenIfReady]);

	// #1089 認証が確立できないまま確定した場合は、null を返し続けて空画面のまま放置せず、
	// 「失敗した」ことと再試行手段をユーザーへ提示する。
	if (isAuthUnavailable && authError) {
		return (
			<AuthErrorFallback isRateLimited={authError.isRateLimited} isRetrying={isRetryingAuth} onRetry={retryAuth} />
		);
	}

	if (!isAppReady) return null;

	return <>{children}</>;
};
