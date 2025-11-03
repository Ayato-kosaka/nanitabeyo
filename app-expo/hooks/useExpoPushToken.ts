import { useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { useAPICall } from "./useAPICall";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "./useLogger";
import type { CreateDeviceTokenResponse } from "@shared/api/v1/res";

const SECURE_STORE_KEY = "expo_push_token";

/**
 * 📲 Expo Push 通知トークン管理フック
 *
 * - アプリ起動時に Push Token を取得し、Backend に登録
 * - Secure Storage にキャッシュし、差分がある場合のみ送信
 * - ログイン後は必ず送信
 * - 匿名ユーザーは登録しない
 *
 * @returns { expoPushToken, error } - Push Token と エラー情報
 */
export const useExpoPushToken = () => {
	const { callBackend } = useAPICall();
	const { user, isAuthenticated } = useAuth();
	const { logFrontendEvent } = useLogger();
	const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const hasSentTokenRef = useRef(false);

	useEffect(() => {
		// #通知機能 【設計】匿名ユーザーは Push Token を登録しない
		if (!isAuthenticated || !user || user.is_anonymous) {
			return;
		}

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
				const tokenData = await Notifications.getExpoPushTokenAsync({
					// #通知機能 【設計】EAS Project ID は Constants から取得（app.json の extra.eas.projectId）
					projectId: Constants.expoConfig?.extra?.eas?.projectId || "e1bd01e3-7e25-4f44-a12c-a3e6f03c9e1c",
				});
				const token = tokenData.data;
				setExpoPushToken(token);

				// #通知機能 【設計】Secure Storage にキャッシュされたトークンを確認
				const cachedToken = await SecureStore.getItemAsync(SECURE_STORE_KEY);

				// #通知機能 【設計】キャッシュとの差分がある場合のみ Backend に送信
				if (cachedToken === token && hasSentTokenRef.current) {
					logFrontendEvent({
						event_name: "push_token_already_registered",
						error_level: "log",
						payload: { token },
					});
					return;
				}

				// #通知機能 【仕様】Backend API 経由で user_device_tokens に upsert
				await callBackend<{ expoPushToken: string }, CreateDeviceTokenResponse>("v1/device-tokens", {
					method: "POST",
					requestPayload: { expoPushToken: token },
				});

				// #通知機能 【設計】Secure Storage にキャッシュを更新
				await SecureStore.setItemAsync(SECURE_STORE_KEY, token);
				hasSentTokenRef.current = true;

				logFrontendEvent({
					event_name: "push_token_registered",
					error_level: "log",
					payload: { token },
				});
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

	return { expoPushToken, error };
};
