import { useCallback, useEffect, useState } from "react";
import { Linking, Platform } from "react-native";

import { getNotificationPermissionState } from "@/features/onboarding/permissions";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogMessage } from "@/lib/errorMessage";

/**
 * 📵 #1510 SET-02 OS 側の通知許可が拒否されているかを読む。
 *
 * アプリ内のカテゴリ設定（アカウント単位）と OS の許可（端末単位）は直交する概念なので、
 * **混ぜずに両方見せる**（リーダー判断 §4）。ここが `true` のとき、設定画面は
 * 案内行と OS 設定への導線を出す。トグル自体は無効化しない。
 *
 * - Web には push が無いため常に `false`（案内を出しても行き先が無い）。
 * - 状態の取得は `features/onboarding/permissions.ts` の既存関数に寄せる。
 *   ここでダイアログを出してはいけない（それは NOT-04 の領分）。
 */
export function useOsNotificationPermission(): {
	isOsNotificationDenied: boolean;
	openOsSettings: () => void;
	refresh: () => void;
} {
	const { logFrontendEvent } = useLogger();
	const [isOsNotificationDenied, setIsOsNotificationDenied] = useState(false);
	const [refreshToken, setRefreshToken] = useState(0);

	useEffect(() => {
		if (Platform.OS === "web") return;

		let isCancelled = false;
		(async () => {
			const state = await getNotificationPermissionState();
			if (isCancelled) return;
			// "prompt"（未回答）は拒否ではない。まだ聞いていないだけなので案内は出さない
			setIsOsNotificationDenied(state === "denied");
		})();

		return () => {
			isCancelled = true;
		};
	}, [refreshToken]);

	const refresh = useCallback(() => {
		setRefreshToken((token) => token + 1);
	}, []);

	const openOsSettings = useCallback(() => {
		logFrontendEvent({
			event_name: "settings_open_os_notification_settings",
			error_level: "log",
			payload: {},
		});
		// openSettings() は端末側の設定アプリを開くだけで、戻ってきたときの状態は
		// 呼び出し側が refresh() で読み直す
		Linking.openSettings().catch((error) => {
			logFrontendEvent({
				event_name: "settings_open_os_notification_settings_failed",
				error_level: "warn",
				payload: { error: toErrorLogMessage(error) },
			});
		});
	}, [logFrontendEvent]);

	return { isOsNotificationDenied, openOsSettings, refresh };
}
