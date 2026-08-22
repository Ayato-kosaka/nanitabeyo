/*
このファイルの責務
- features/onboarding/permissions.ts の web 実装。

#932 の教訓に従い、web では expo-location を経由しない。expo-location の web 実装は
内部で `navigator.permissions.query` を呼び、環境によっては "Illegal invocation" 等の
未捕捉例外を投げる（hooks/useCurrentLocationPosition.web.ts のコメント参照）。
ブラウザの許可プロンプトを出したいだけなので、`navigator.geolocation` を直接叩く。

通知も同じ方針で、expo-notifications ではなくブラウザの Notification API を直接使う。
*/
import type { PermissionOutcome, PermissionPromptState } from "./permissions";

export type { PermissionOutcome, PermissionPromptState } from "./permissions";

/**
 * 位置情報の許可ダイアログを «これから出せるか» を読む（ダイアログは出さない）。
 *
 * Permissions API が使えない環境（古い Safari 等）では `prompt` へ倒す。
 * 誤って `prompt` と判定しても «説明画面が出て要求される» という従来の挙動に戻るだけで、
 * 逆（回答済みなのに毎回一瞬画面が出る）より害が小さい。
 *
 * ⚠️ #932 の "Illegal invocation" は expo-location が `query` を this から
 * 切り離して呼ぶことが原因。ここは `navigator.permissions.query(...)` を
 * レシーバ付きで直接呼ぶので該当しないが、環境差への保険として try/catch は残す。
 */
export const getLocationPermissionState = async (): Promise<PermissionPromptState> => {
	if (typeof navigator === "undefined" || !navigator.geolocation) return "unavailable";

	try {
		if (!navigator.permissions?.query) return "prompt";
		const status = await navigator.permissions.query({ name: "geolocation" });
		if (status.state === "granted") return "granted";
		if (status.state === "denied") return "denied";
		return "prompt";
	} catch {
		return "prompt";
	}
};

/** 通知の許可ダイアログを «これから出せるか» を読む（ダイアログは出さない） */
export const getNotificationPermissionState = async (): Promise<PermissionPromptState> => {
	if (typeof window === "undefined" || typeof Notification === "undefined") return "unavailable";
	if (Notification.permission === "granted") return "granted";
	if (Notification.permission === "denied") return "denied";
	return "prompt";
};

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
