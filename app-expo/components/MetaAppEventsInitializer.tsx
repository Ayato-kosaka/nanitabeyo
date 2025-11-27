import { useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requestTrackingPermissionsAsync, getTrackingPermissionsAsync } from "expo-tracking-transparency";
import { AppEventsLogger, Settings } from "react-native-fbsdk-next";
import { Env } from "@/constants/Env";

/**
 * #492 【設計】Meta (Facebook) App Events 初期化用コンポーネント。
 *
 * - 初回起動時に ATT (App Tracking Transparency) 許可ダイアログを表示（iOS のみ）
 * - 初回起動時に `fb_mobile_activate_app` イベントを Meta へ送信
 * - 二重送信を防ぐため AsyncStorage でフラグ管理
 * - Expo Go では動作しない（EAS Build / Dev Client が必要）
 *
 * @returns null（UI を持たない初期化専用コンポーネント）
 */
export const MetaAppEventsInitializer = () => {
	const hasInitializedRef = useRef(false);

	const initializeMetaAppEvents = useCallback(async () => {
		if (hasInitializedRef.current) return;
		hasInitializedRef.current = true;

		// #492 【設計】Web は Meta SDK 非対応のためスキップ
		if (Platform.OS === "web") return;

		try {
			// #492 【設計】iOS14+ では ATT 許可をリクエスト
			if (Platform.OS === "ios") {
				const { status } = await getTrackingPermissionsAsync();
				if (status === "undetermined") {
					await requestTrackingPermissionsAsync();
				}
			}

			// #492 【設計】初回起動かどうかを AsyncStorage で確認
			const hasActivated = await AsyncStorage.getItem("@meta_app_activated");
			if (hasActivated) {
				return;
			}

			// #492 【設計】Meta SDK の広告 ID 収集を有効化
			Settings.setAdvertiserTrackingEnabled(true);

			// #492 【設計】fb_mobile_activate_app イベントを送信（初回のみ）
			AppEventsLogger.logEvent("fb_mobile_activate_app");

			// #492 【設計】初回起動フラグを保存（二重送信防止）
			await AsyncStorage.setItem("@meta_app_activated", "true");

			if (Env.NODE_ENV === "development") {
				console.log("[MetaAppEventsInitializer] fb_mobile_activate_app event sent");
			}
		} catch (error) {
			if (Env.NODE_ENV === "development") {
				console.error("[MetaAppEventsInitializer] Failed to initialize Meta App Events:", error);
			}
		}
	}, []);

	useEffect(() => {
		initializeMetaAppEvents();
	}, [initializeMetaAppEvents]);

	return null;
};
