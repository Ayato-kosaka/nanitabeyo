/*
このファイルの責務
- features/onboarding/permissions.ts の web 実装。

#932 の教訓に従い、web では expo-location を経由しない。expo-location の web 実装は
内部で `navigator.permissions.query` を呼び、環境によっては "Illegal invocation" 等の
未捕捉例外を投げる（hooks/useCurrentLocationPosition.web.ts のコメント参照）。
ブラウザの許可プロンプトを出したいだけなので、`navigator.geolocation` を直接叩く。

通知も同じ方針で、expo-notifications ではなくブラウザの Notification API を直接使う。
*/
import type { PermissionOutcome } from "./permissions";

export type { PermissionOutcome } from "./permissions";

/** ブラウザに位置情報の許可を尋ねる。測位そのものは待たない（許可プロンプトを出すのが目的） */
export const requestLocationPermission = async (): Promise<PermissionOutcome> => {
	if (typeof navigator === "undefined" || !navigator.geolocation) return "unavailable";

	return new Promise<PermissionOutcome>((resolve) => {
		navigator.geolocation.getCurrentPosition(
			() => resolve("granted"),
			(error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"),
			// 許可プロンプトへの応答を待つのが目的なので、測位の精度も鮮度も要らない。
			// `maximumAge: Infinity` にすると «既知の位置があれば即座に返る» ため、
			// 許可済みのユーザーを測位で待たせない
			{ enableHighAccuracy: false, timeout: 15000, maximumAge: Infinity },
		);
	});
};

/** ブラウザに通知の許可を尋ねる */
export const requestNotificationPermission = async (): Promise<PermissionOutcome> => {
	if (typeof window === "undefined" || typeof Notification === "undefined") return "unavailable";

	try {
		if (Notification.permission === "granted") return "granted";
		if (Notification.permission === "denied") return "denied";

		const permission = await Notification.requestPermission();
		return permission === "granted" ? "granted" : "denied";
	} catch {
		return "unavailable";
	}
};
