import { useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useAPICall } from "../hooks/useAPICall";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "../hooks/useLogger";
import type { CreateDeviceTokenResponse } from "@shared/api/v1/res";
import { Env } from "@/constants/Env";
import type { CreateDeviceTokenDto } from "@shared/api/v1/dto";

const SECURE_STORE_KEY = "expo_push_token";
type PushCache = {
	token: string;
	userId: string;
	platform: string;
	appVersion?: string | null;
};

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
	const { user, isAuthenticated } = useAuth();
	const { logFrontendEvent } = useLogger();
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		// #通知機能 【設計】匿名ユーザーは Push Token を登録しない
		if (!isAuthenticated || !user || user.is_anonymous) return;

		const registerPushToken = async () => {
			try {
				// #通知機能 【設計】物理デバイスのみ Push 通知を有効化
				if (!Device.isDevice) {
					logFrontendEvent({
						event_name: "push_token_skipped_simulator",
						error_level: "log",
						payload: { reason: "Not a physical device" },
					});
					return;
				}

				// #通知機能 【仕様】通知許可をリクエスト
				const { status: existingStatus } = await Notifications.getPermissionsAsync();
				let finalStatus = existingStatus;
				if (existingStatus !== "granted") {
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
				const cached: PushCache | null = raw ? JSON.parse(raw) : null;

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
	}, [isAuthenticated, user, callBackend, logFrontendEvent]);

	// #通知機能 【設計】Android では通知チャンネルを設定
	useEffect(() => {
		if (Platform.OS === "android") {
			Notifications.setNotificationChannelAsync("default", {
				name: "default",
				importance: Notifications.AndroidImportance.MAX,
				vibrationPattern: [0, 250, 250, 250],
				lightColor: "#FF231F7C",
			});
		}
	}, []);

	return null;
}
