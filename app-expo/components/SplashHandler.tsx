import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { useAuth } from "@/contexts/AuthProvider";
import { getRemoteConfigSource, initRemoteConfig } from "@/lib/remoteConfig";
import { Env } from "@/constants/Env";
import { retry } from "@/lib/retry";
import { AuthErrorFallback } from "@/components/AuthErrorFallback";
import { useLogger } from "@/hooks/useLogger";

/**
 * 🔁 `SplashScreen.hideAsync()` を試す最大回数。
 *
 * 失敗したまま諦めると native はスプラッシュが張り付いて操作不能になる（#1089）ので必ず再試行するが、
 * 無条件に繰り返すと「常に reject する端末」でレンダリングループになるため上限を置く。
 * hideAsync() の失敗はスプラッシュがまだ登録されていない等の一過性が主なので、数回で十分。
 */
const MAX_SPLASH_HIDE_ATTEMPTS = 3;

/**
 * 🧯 アプリ起動時の Splash 画面を制御するコンポーネント。
 *
 * - **何も待たない**（フォント: PR1 / Remote Config: PR3 / 認証: PR4b で順に外した）
 * - マウント直後に Splash を非表示にし、アプリ本体を表示する
 * - Remote Config の初期化は背後で走らせ、値の出所だけログに残す
 *
 * @param children - アプリのメイン画面
 * @returns JSX構造
 */
export const SplashHandler = ({ children }: { children: React.ReactNode }) => {
	const { loading: isAuthLoading, user, authError, retryAuth, isRetryingAuth } = useAuth();
	const { logFrontendEvent } = useLogger();

	const hasSplashBeenHiddenRef = useRef(false);
	/**
	 * 🔁 hideAsync() が失敗した回数。**再試行のトリガを兼ねる**ので ref ではなく state。
	 * ここを ref にすると値は増えても再レンダリングが起きず、下の effect が再発火しない = 再試行されない。
	 */
	const [splashHideAttempt, setSplashHideAttempt] = useState(0);
	const hasLoggedRemoteConfigSourceRef = useRef(false);

	/**
	 * 🔧 Remote Config の初期化処理
	 *
	 * #1092 PR3 【修正】この完了は **描画の条件ではなくなった**（下の `canRenderFirstFrame` を参照）。
	 * ここは「背後で最新値を取りに行き、値の出所を 1 回だけログに残す」だけの処理になっている。
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
						/*
						#1629 【追加】**OS とそのバージョンを残す。**

						実機報告（「Android でキーボードに隠れる」等）を追うとき、
						**どの OS バージョンの話なのかがログのどこにも無かった**。
						Android は 15（API 35）から edge-to-edge が強制され、
						`adjustResize` に頼った作りの挙動が変わるため、
						«API 34 のエミュレータでは再現しないが実機では起きる» が普通に起こる
						（実際、CI の Detox は API 34 で緑のまま、実機の報告が続いた）。

						`Platform.Version` は Android では API レベルの数値、iOS では OS の
						バージョン文字列になる。起動時 1 回だけなのでログ量も増えない。
						*/
						platform: Platform.OS,
						os_version: String(Platform.Version),
					},
				});
			}
		}
	}, [logFrontendEvent]);

	/**
	 * #1089 認証が確立できないまま確定した状態。children ではなくエラー UI を出す。
	 * Remote Config の完了は待たない（待つとエラーの提示が遅れるだけ）。
	 */
	const isAuthUnavailable = !isAuthLoading && !user && !!authError;

	/**
	 * 📌 「何かを描画できる状態」か。これが Splash を解除してよいタイミングと一致する。
	 *
	 * 下の描画分岐と 1 対 1 で対応させること。
	 * ここが描画分岐より **緩い**と真っ白な画面が見え、**厳しい**と描画済みなのにスプラッシュが被る。
	 *
	 * #1092 PR3 【修正】最後まで残っていた `isRemoteConfigReady` を外し、**常に true** にした。
	 * Remote Config は PR2 で既定値をアプリへ埋め込み、PR3 で前回値を AsyncStorage から復元するので、
	 * `getRemoteConfig()` は CDN 取得の前から意味のある値を返す。つまり CDN の往復
	 * （回線が細い端末では秒単位）を待つ理由はもう無い。描画分岐も `return null` を持たず、
	 * エラー UI か children のどちらかを必ず返すので、対応関係は保たれている。
	 *
	 * ⚠️ 型注釈 `: boolean` は意図的。`true` リテラル型に推論させると、下の
	 *    `if (!canRenderFirstFrame) return;` が到達不能扱いになり、
	 *    再びゲートを足したくなったときに黙って壊れる形になる。
	 *
	 * ⚠️ 待機条件をここへ戻さないこと。戻すと #1092 が丸ごと退行する。
	 *    描画を遅らせたい事情ができたら、SplashHandler ではなく個々の画面側で吸収すること。
	 */
	const canRenderFirstFrame: boolean = true;

	/**
	 * 🎬 Splash 非表示ロジック
	 * - **成功したら一度だけ**で済むようフラグで制御し、失敗したら上限まで再試行する
	 *
	 * #1092 【修正】条件を「認証が確定したか」から「最初のフレームを描画できるか」へ変えた。
	 * ゲートを外して UI を先に出すようにした以上、スプラッシュも同じ時点で解除しないと、
	 * 描画できているのにスプラッシュに隠されたままになり、この PR の効果が丸ごと消える。
	 * PR3 で待機対象が全て消えたので、実際にはマウント直後の 1 回で解除される。
	 *
	 * #1089 【非退行】どの経路でも必ず一度は hideAsync() が呼ばれること。
	 * 以前は条件が `user` だけだったため、匿名サインインが失敗した端末では hideAsync() が
	 * 永久に呼ばれず、native はスプラッシュが張り付いたままになっていた。
	 * 今は認証にも Remote Config にも依存しないので、どちらが失敗しようと解除される。
	 * **認証や Remote Config の状態を必須条件に戻さないこと。**
	 *
	 * #1092 【非退行】hideAsync() が reject した場合も必ず呼び直されること。
	 * 「呼んだ」フラグを戻すだけでは不十分で、**戻した後に誰かが呼び直す経路**が要る。
	 * この effect の依存は `canRenderFirstFrame`（一度 true になると変わらない）由来なので、
	 * 失敗した回数を state に載せて自分で再発火させている。ここを ref にしたり
	 * `setSplashHideAttempt` を消したりすると、フラグを戻す処理が黙って死にコードになり、
	 * hideAsync() の失敗＝スプラッシュ張り付き（操作不能）が復活する。
	 */
	const hideSplashScreenIfReady = useCallback(async () => {
		if (!canRenderFirstFrame) return;
		if (hasSplashBeenHiddenRef.current) return;
		// 🛑 再試行の打ち切り。ここが無いと hideAsync() が常に reject する端末で
		//    「失敗 → setState → 再レンダリング → 失敗」の無限ループになる
		if (splashHideAttempt >= MAX_SPLASH_HIDE_ATTEMPTS) return;

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
			// 🔁 フラグを戻すだけでは誰も呼び直さない（下の effect の依存は canRenderFirstFrame 由来で、
			//    これは一度 true になったら二度と変わらない）ので、失敗を state に載せて能動的に再発火させる。
			//    ⚠️ 「認証の遷移でたまたま effect が再発火する」に頼ってはいけない。#1092 でその依存を
			//    外した以上、再試行の経路はここだけになる（#1089 のスプラッシュ張り付きの再来を防ぐ）。
			setSplashHideAttempt((attempt) => attempt + 1);
		}
	}, [canRenderFirstFrame, splashHideAttempt]);

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

	// #1092 PR3 `return null` の経路はもう無い。ここに待機ゲートを足すと、上の
	// `canRenderFirstFrame` との 1 対 1 対応が崩れて「解除済みのスプラッシュの下に空画面」になる。
	//
	// ⚠️ children は `user === null`（PR4b）かつ Remote Config が既定値／保存値（PR3）の状態で
	//    マウントされる。その前提に耐えられるようにする作業は先行 PR で済ませてある:
	//    - PR4a … `useAPICall` の `code: "unauthenticated"`、`HealthCheckInitializer` /
	//             `useAutoCurrentLocation` の auth 解決後 1 回だけの再試行、ログイン UI（現 `LoginForm`）の null ガード
	//    - PR2  … `getRemoteConfig()` が null を返さない（`parseInt(undefined) = NaN` を塞いだ）
	return <>{children}</>;
};
