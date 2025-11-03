import { useState, useEffect, useCallback, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { useAPICall } from "./useAPICall";
import { useAuth } from "@/contexts/AuthProvider";
import { useLogger } from "./useLogger";

const EXPO_PUSH_TOKEN_KEY = "expoPushToken";

// #通知機能 【設計】通知が来たときの表示/動作設定
Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowBanner: true,
		shouldShowList: true,
		shouldPlaySound: true,
		shouldSetBadge: true,
	}),
});

/**
 * 🔔 通知許可取得・トークン登録フック
 *
 * - アプリ起動時/ログイン後に実行
 * - 取得した Expo Push Token を Backend 経由で user_device_tokens に upsert
 * - 匿名ユーザーは登録を行わない
 * - トークンを SecureStore にキャッシュし、変更があれば送信
 */
export const useNotifications = () => {
	const { callBackend } = useAPICall();
	const { user, isAuthenticated } = useAuth();
	const { logFrontendEvent } = useLogger();
	const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
	const [permissionStatus, setPermissionStatus] = useState<Notifications.PermissionStatus | null>(null);
	const isRegistering = useRef(false);

	/**
	 * 🔐 通知許可を取得し、Expo Push Token を取得する
	 */
	const registerForPushNotificationsAsync = useCallback(async (): Promise<string | null> => {
		// #通知機能 【仕様】物理デバイスのみ通知機能をサポート
		if (!Device.isDevice) {
			logFrontendEvent({
				event_name: "push_notification_skip",
				error_level: "log",
				payload: { reason: "not_physical_device" },
			});
			return null;
		}

		try {
			// 通知許可の取得
			const { status: existingStatus } = await Notifications.getPermissionsAsync();
			let finalStatus = existingStatus;
			setPermissionStatus(finalStatus);

			if (existingStatus !== "granted") {
				const { status } = await Notifications.requestPermissionsAsync();
				finalStatus = status;
				setPermissionStatus(finalStatus);
			}

			if (finalStatus !== "granted") {
				logFrontendEvent({
					event_name: "push_notification_permission_denied",
					error_level: "log",
					payload: { status: finalStatus },
				});
				return null;
			}

			// #通知機能 【設計】Expo Push Token を取得
			const projectId = Constants.expoConfig?.extra?.eas?.projectId as string;
			if (!projectId) {
				throw new Error("EAS Project ID is not configured in app.config.ts");
			}

			const tokenData = await Notifications.getExpoPushTokenAsync({
				projectId,
			});

			logFrontendEvent({
				event_name: "expo_push_token_obtained",
				error_level: "log",
				payload: { tokenPreview: `${tokenData.data.substring(0, 20)}...` }, // #通知機能 【セキュリティ】トークン全体ではなくプレビューのみをログに記録
			});

			return tokenData.data;
		} catch (error: any) {
			logFrontendEvent({
				event_name: "expo_push_token_error",
				error_level: "error",
				payload: { error: error.message },
			});
			return null;
		}
	}, [logFrontendEvent]);

	/**
	 * 📤 Backend にデバイストークンを送信
	 */
	const sendTokenToBackend = useCallback(
		async (token: string) => {
			if (isRegistering.current) return;
			isRegistering.current = true;

			try {
				await callBackend("v1/device-tokens", {
					method: "POST",
					requestPayload: { expoPushToken: token },
				});

				logFrontendEvent({
					event_name: "device_token_registered",
					error_level: "log",
					payload: { tokenPreview: `${token.substring(0, 20)}...` }, // #通知機能 【セキュリティ】トークン全体ではなくプレビューのみをログに記録
				});

				// #通知機能 【設計】送信成功時は SecureStore にキャッシュ
				await SecureStore.setItemAsync(EXPO_PUSH_TOKEN_KEY, token);
			} catch (error: any) {
				logFrontendEvent({
					event_name: "device_token_registration_error",
					error_level: "error",
					payload: { error: error.message },
				});
			} finally {
				isRegistering.current = false;
			}
		},
		[callBackend, logFrontendEvent],
	);

	/**
	 * 🔄 トークンをキャッシュと比較し、変更があれば送信
	 */
	const checkAndRegisterToken = useCallback(
		async (forceRegister = false) => {
			// #通知機能 【仕様】匿名ユーザーはトークン登録を行わない
			if (!isAuthenticated || !user || user.is_anonymous) {
				return;
			}

			const token = await registerForPushNotificationsAsync();
			if (!token) return;

			setExpoPushToken(token);

			// #通知機能 【設計】ログイン後は必ず送信、それ以外はキャッシュと比較
			if (forceRegister) {
				await sendTokenToBackend(token);
				return;
			}

			// キャッシュされたトークンと比較
			const cachedToken = await SecureStore.getItemAsync(EXPO_PUSH_TOKEN_KEY);
			if (cachedToken !== token) {
				await sendTokenToBackend(token);
			}
		},
		[isAuthenticated, user, registerForPushNotificationsAsync, sendTokenToBackend],
	);

	// #通知機能 【設計】アプリ起動時にトークン登録（認証済みの場合のみ）
	useEffect(() => {
		if (isAuthenticated && user && !user.is_anonymous) {
			checkAndRegisterToken(false);
		}
	}, [isAuthenticated, user]);

	return {
		expoPushToken,
		permissionStatus,
		checkAndRegisterToken,
	};
};
