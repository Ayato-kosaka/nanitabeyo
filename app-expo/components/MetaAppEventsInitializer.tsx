import { useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import { requestTrackingPermissionsAsync, getTrackingPermissionsAsync } from "expo-tracking-transparency";
import { Settings } from "react-native-fbsdk-next";
import { Env } from "@/constants/Env";

/**
 * #492 【設計】Meta (Facebook) App Events 初期化用コンポーネント。
 *
 * - Meta SDK を明示的に初期化
 * - 初回起動時に ATT (App Tracking Transparency) 許可ダイアログを表示（iOS のみ）
 * - ATT 許可ステータスに基づいて広告 ID 収集を設定
 * - `fb_mobile_activate_app` は `autoLogAppEventsEnabled: true` により SDK が自動送信するため手動送信しない
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
			// #492 【設計】SDK を明示的に初期化（他の Settings 呼び出しより先に実行）
			Settings.initializeSDK();

			// #492 【設計】iOS14+ では ATT 許可をリクエストし、結果に基づいて広告 ID 収集を設定
			let trackingEnabled = true; // Android はデフォルトで有効
			if (Platform.OS === "ios") {
				let { status } = await getTrackingPermissionsAsync();
				if (status === "undetermined") {
					const result = await requestTrackingPermissionsAsync();
					status = result.status;
				}
				// #492 【設計】ATT 許可ステータスに基づいて広告 ID 収集を設定
				trackingEnabled = status === "granted";
			}
			Settings.setAdvertiserTrackingEnabled(trackingEnabled);

			if (Env.NODE_ENV === "development") {
				console.log("[MetaAppEventsInitializer] Meta SDK initialized, tracking:", trackingEnabled);
			}
		} catch (error) {
			if (Env.NODE_ENV === "development") {
				console.error("[MetaAppEventsInitializer] Failed to initialize Meta SDK:", error);
			}
		}
	}, []);

	useEffect(() => {
		initializeMetaAppEvents();
	}, [initializeMetaAppEvents]);

	return null;
};
