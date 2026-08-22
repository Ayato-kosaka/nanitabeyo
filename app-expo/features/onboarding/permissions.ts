/*
このファイルの責務
- オンボーディングの許可フロー（#1486 §5 / §6）で OS の許可ダイアログを «出すだけ» の関数を持つ。

⚠️ ここでは位置情報の «値» を取らない。取得した座標を使うのは検索画面の責務で
（hooks/useCurrentLocationPosition.ts）、オンボーディングの目的は「許可を尋ねること」だけである。
測位まで待つと、GPS を掴めない場所で最大 10 秒フリーズしてから次の画面へ進むことになる。

## 戻り値の設計

許可 / 拒否のどちらでもオンボーディングは止めない（#1486 §9）。呼び出し側が分岐する必要は
無いので、結果はログのためだけに返す。**例外は投げない**。ここで throw すると、
許可を求めただけでオンボーディングが止まる。

web 実装は permissions.web.ts。
*/
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";

/** OS へ尋ねた結果。`unavailable` は「この環境では尋ねられなかった」 */
export type PermissionOutcome = "granted" | "denied" | "unavailable";

/**
 * 位置情報（使用中のみ）の許可を求める（#1486 §5）。
 *
 * すでに回答済みなら OS はダイアログを出さず、現在の状態をそのまま返す
 *（#1486 §5「すでに回答済みの場合はOS仕様に従い再表示しない」は OS 側の挙動で満たされる）。
 */
export const requestLocationPermission = async (): Promise<PermissionOutcome> => {
	try {
		const { status } = await Location.requestForegroundPermissionsAsync();
		return status === "granted" ? "granted" : "denied";
	} catch {
		return "unavailable";
	}
};

/**
 * 通知の許可を求める（#1486 §6）。
 *
 * `getPermissionsAsync()` を先に見るのは components/PushTokenRegistration.tsx と同じ形。
 * 未回答のときだけ `requestPermissionsAsync()` を呼ぶことで、
 * 「拒否済みのユーザーに対して毎回無駄な往復をする」のを避ける。
 */
export const requestNotificationPermission = async (): Promise<PermissionOutcome> => {
	try {
		const { status: existingStatus } = await Notifications.getPermissionsAsync();
		if (existingStatus === "granted") return "granted";
		// undetermined 以外（= denied）で request しても OS はダイアログを出さず即座に denied を返す。
		// それでも呼ぶのは、状態の読み取りと «要求した» という事実をこの関数に一本化しておくため
		const { status } = await Notifications.requestPermissionsAsync();
		return status === "granted" ? "granted" : "denied";
	} catch {
		return "unavailable";
	}
};
