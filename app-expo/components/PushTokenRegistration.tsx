import { useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { usePathname } from "expo-router";
import { useAPICall } from "../hooks/useAPICall";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { isOnboardingPath } from "@/features/onboarding/navigation";
import { loadOnboardingSeen } from "@/features/onboarding/onboardingSeenStore";
import { wasDeniedInOnboarding } from "@/features/onboarding/permissionOutcomes";
import i18n from "@/lib/i18n";
import { useLogger } from "../hooks/useLogger";
import type { CreateDeviceTokenResponse } from "@shared/api/v1/res";
import { Env } from "@/constants/Env";
import type { CreateDeviceTokenDto } from "@shared/api/v1/dto";
import { readPushCache, type PushCache } from "./pushTokenCache";
import { FixedColors } from "@/constants/Palette";

const SECURE_STORE_KEY = "expo_push_token";

/**
 * 📲 Push 通知トークン登録コンポーネント
 *
 * - アプリ起動時に Push Token を取得し、Backend に登録
 * - Secure Storage にキャッシュし、差分がある場合のみ送信
 * - ログイン後は必ず送信
 * - 匿名ユーザーは登録しない
 * - UI をレンダリングせず、副作用のみ実行
 */
export function PushTokenRegistration() {
	const { callBackend } = useAPICall();
	const { user } = useAuth();
	const { logFrontendEvent } = useLogger();
	const [error, setError] = useState<string | null>(null);
	const pathname = usePathname();

	/**
	 * #1486 §6【設計】このコンポーネントは «許可を尋ねる» 主体でもある
	 *（未回答なら `requestPermissionsAsync()` を呼ぶ）。
	 *
	 * オンボーディング中はそれを止める。止めないと、ログイン画面でログインが成立した瞬間に
	 * ここが動き出し、**通知の説明画面が出るより先に** OS の許可ダイアログが出てしまう。
	 * チケットは「説明画面表示と同時に通知許可ダイアログを表示」と定めており、
	 * 説明の無いダイアログはまさに避けたかったものである。
	 *
	 * オンボーディングを抜けたらこの effect が張り直され、そのときには
	 * 通知説明画面で回答済みなので、ここは «トークンの登録» だけを行う。
	 */
	const isInOnboarding = isOnboardingPath(pathname);

	// 画面遷移のたびに登録処理をやり直さないための番人。
	// pathname を依存に足した結果、この effect はナビゲーションのたびに再実行されるようになった
	const registeredUserIdRef = useRef<string | null>(null);

	useEffect(() => {
		// #通知機能 【設計】匿名ユーザーは Push Token を登録しない
		// #1092 PR4b 判定は共通化（lib/authGuest.ts）。通知タブの表示可否と同じ式にしておく。
		// `!user` を残しているのは判定のためではなく、この後の user.id 参照を TS に絞り込ませるため
		// （isGuestUser は boolean を返すだけなので null を除いてくれない）
		if (!user || isGuestUser(user)) return;
		if (isInOnboarding) return;
		if (registeredUserIdRef.current === user.id) return;
		registeredUserIdRef.current = user.id;

		const registerPushToken = async () => {
			try {
				// #1486 §6【設計】パス判定だけでは足りない: コールドスタート直後の `usePathname()` は
				// オンボーディングへ push される **前の** `/ja-JP` を一瞬返すため、その隙間で
				// ここが動き出し、通知の説明画面より先に OS の許可ダイアログが出てしまう
				//（ATT と同じ実機バグ）。未読の日本語ユーザーは見送り、完了後の画面遷移
				//（Welcome → アプリ本体で pathname が変わり、この effect が再実行される）で改めて通る。
				// 日本語以外のユーザーはオンボーディングを通らずフラグが立たない（#642）ので見送らない。
				//
				// ⚠️ ここは «描画中の購読»（useOnboardingSeen 等）にしないこと。このコンポーネントで
				// 既読ストアを購読すると、オンボーディングへの push 遷移中の再描画と干渉して
				// [locale] レイアウトが作り直され、AppProvider(LoadScript) が「google api is
				// already presented」で固まり **アプリ全体が Loading のまま止まる**（e2e で実証済み）。
				// effect 内の非同期読み取りなら描画に影響しない。
				const seen = await loadOnboardingSeen();
				const isJapanese = ["ja-JP", "ja"].includes(i18n.locale);
				if (!seen && isJapanese) {
					// 番人を外し、オンボーディング完了後の遷移で再試行できるようにする
					registeredUserIdRef.current = null;
					return;
				}

				// #通知機能 【設計】物理デバイスのみ Push 通知を有効化
				// web は、 expo-server-sdk で対応していないため除外
				// エミュレータでスキップしないと致命的に困ることはあまりないが、
				// DB が肥大化するのを防ぐため、開発環境以外ではスキップする
				const isDevBuild = Env.NODE_ENV === "development";
				if (Platform.OS === "web" || (!Device.isDevice && !isDevBuild)) {
					logFrontendEvent({
						event_name: "push_registration_skipped_not_physical_device",
						error_level: "log",
						payload: { reason: "Skipping push registration: not a mobile device" },
					});
					return;
				}

				// #通知機能 【仕様】通知許可をリクエスト
				const { status: existingStatus } = await Notifications.getPermissionsAsync();
				let finalStatus = existingStatus;
				if (existingStatus !== "granted") {
					// #1736 【バグ】オンボーディングの通知許可画面で «許可しない» と答えた直後、
					// ここが要求をやり直して **説明の無い OS ダイアログをもう一度**出していた
					// （この effect はオンボーディングを抜けた瞬間に張り直される。
					//  Android 13+ の POST_NOTIFICATIONS は canAskAgain が残っていれば再表示される）。
					// この起動でオンボーディングが尋ねて断られていたら、要求はしない
					if (wasDeniedInOnboarding("notifications")) {
						logFrontendEvent({
							event_name: "push_permission_skipped_after_onboarding_denied",
							error_level: "log",
							payload: { status: existingStatus },
						});
						// 番人は外さない。既存の «拒否された» 経路と同じく、この起動では再試行しない
						return;
					}

					const { status } = await Notifications.requestPermissionsAsync();
					finalStatus = status;
				}
				if (finalStatus !== "granted") {
					setError("Permission not granted for push notifications");
					logFrontendEvent({
						event_name: "push_permission_denied",
						error_level: "warn",
						payload: { status: finalStatus },
					});
					return;
				}

				// #通知機能 【仕様】Expo Push Token を取得
				const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: Env.EAS_PROJECT_ID });
				const currentToken = tokenData.data;

				// #通知機能 【設計】Secure Storage にキャッシュされたトークンを確認
				const raw = await SecureStore.getItemAsync(SECURE_STORE_KEY);
				// #1599 壊れた値は «キャッシュ無し» に倒す（詳細は readPushCache）。
				// ここで throw すると、下の setItemAsync（壊れた値の上書き）へ辿り着けず
				// **Push 通知が二度と登録されない**まま再試行が回り続ける
				const cached: PushCache | null = readPushCache(raw);

				const current: PushCache = {
					token: currentToken,
					userId: user.id,
					platform: Platform.OS,
					appVersion: Env.APP_VERSION,
				};

				const needsSync =
					!cached ||
					cached.token !== current.token ||
					cached.userId !== current.userId ||
					cached.platform !== current.platform ||
					cached.appVersion !== current.appVersion;

				// #通知機能 【設計】 キャッシュと差分がなければ送信不要
				if (!needsSync) {
					logFrontendEvent({
						event_name: "push_token_already_registered",
						error_level: "log",
						payload: { token: currentToken },
					});
					return;
				}

				// #通知機能 【仕様】Backend API 経由で user_device_tokens に upsert
				await callBackend<CreateDeviceTokenDto, CreateDeviceTokenResponse>("v1/device-tokens", {
					method: "POST",
					requestPayload: { expoPushToken: currentToken },
				});

				// #通知機能 【設計】Secure Storage にキャッシュを更新
				await SecureStore.setItemAsync(SECURE_STORE_KEY, JSON.stringify(current));
			} catch (err: any) {
				// 失敗したら番人を外し、次の再描画で再試行できるようにする
				//（依存が `user?.id` だけだった頃は、周辺の依存が変わるたびに実質再試行されていた）
				registeredUserIdRef.current = null;
				const errorMessage = err?.message || "Failed to register push token";
				setError(errorMessage);
				logFrontendEvent({
					event_name: "push_token_registration_error",
					error_level: "error",
					payload: { error: errorMessage },
				});
			}
		};

		registerPushToken();
	}, [user, isInOnboarding, callBackend, logFrontendEvent]);

	// #通知機能 【設計】Android では通知チャンネルを設定
	useEffect(() => {
		if (Platform.OS === "android") {
			Notifications.setNotificationChannelAsync("default", {
				name: "default",
				importance: Notifications.AndroidImportance.MAX,
				vibrationPattern: [0, 250, 250, 250],
				// #1629 これはアプリが描く色ではなく、OS の通知 LED へ渡す ARGB のパラメータ。
				// テーマに追従させる対象ではないので FixedColors に置いてある
				lightColor: FixedColors.notificationLed,
			});
		}
	}, []);

	return null;
}
