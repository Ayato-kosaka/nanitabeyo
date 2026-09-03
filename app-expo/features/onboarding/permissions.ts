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
 * «これから尋ねたら OS のダイアログが出るか» の事前判定。
 *
 * `prompt` のときだけ説明画面を出す価値がある。すでに回答済み（granted / denied）や
 * 尋ねられない環境（unavailable）で説明画面を出すと、要求が即座に返って
 * **画面が一瞬光って消える**（web で実際に起きた指摘）。呼び出し側は
 * `prompt` 以外なら説明画面を描かずに次へ進むこと。
 */
export type PermissionPromptState = "prompt" | "granted" | "denied" | "unavailable";

/**
 * 位置情報の許可ダイアログを «これから出せるか» を読む（ダイアログは出さない）。
 *
 * Android は一度拒否されても `canAskAgain` が true の間はもう一度ダイアログを出せるため
 * `prompt` へ倒す。iOS は一度回答すると `canAskAgain` が false になり `denied` になる。
 */
export const getLocationPermissionState = async (): Promise<PermissionPromptState> => {
	try {
		const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
		if (status === "granted") return "granted";
		if (status === "undetermined") return "prompt";
		return canAskAgain ? "prompt" : "denied";
	} catch {
		return "unavailable";
	}
};

/** 通知の許可ダイアログを «これから出せるか» を読む（ダイアログは出さない） */
export const getNotificationPermissionState = async (): Promise<PermissionPromptState> => {
	try {
		const { status, canAskAgain } = await Notifications.getPermissionsAsync();
		if (status === "granted") return "granted";
		if (status === "undetermined") return "prompt";
		return canAskAgain ? "prompt" : "denied";
	} catch {
		return "unavailable";
	}
};

/**
 * 進行中の要求。**同じ許可を二重に OS へ投げない**ための番人（#1736）。
 *
 * 権限の説明画面が何らかの理由で 2 枚同時に立つと（実際に #1736 で起きた）、
 * それぞれが `requestXxxPermissionsAsync()` を呼び、Android はダイアログを 2 回出す。
 * 画面側の `hasSettledRef` は «二重に次へ進む» ことしか防げないので、
 * **OS へ届く要求の側**でも 1 本に畳んでおく。
 *
 * 進行中の間だけ共有し、決着したら捨てる（後から «許可へ変えて戻ってきた» 人の
 * 再要求まで古い答えで返さないため）。
 */
const singleFlight = (run: () => Promise<PermissionOutcome>): (() => Promise<PermissionOutcome>) => {
	let inFlight: Promise<PermissionOutcome> | null = null;

	return () => {
		if (inFlight) return inFlight;
		inFlight = run().finally(() => {
			inFlight = null;
		});
		return inFlight;
	};
};

/**
 * 位置情報（使用中のみ）の許可を求める（#1486 §5）。
 *
 * すでに回答済みなら OS はダイアログを出さず、現在の状態をそのまま返す
 *（#1486 §5「すでに回答済みの場合はOS仕様に従い再表示しない」は OS 側の挙動で満たされる）。
 */
export const requestLocationPermission = singleFlight(async (): Promise<PermissionOutcome> => {
	try {
		const { status } = await Location.requestForegroundPermissionsAsync();
		return status === "granted" ? "granted" : "denied";
	} catch {
		return "unavailable";
	}
});

/**
 * 通知の許可を求める（#1486 §6）。
 *
 * `getPermissionsAsync()` を先に見るのは components/PushTokenRegistration.tsx と同じ形。
 * 未回答のときだけ `requestPermissionsAsync()` を呼ぶことで、
 * 「拒否済みのユーザーに対して毎回無駄な往復をする」のを避ける。
 */
export const requestNotificationPermission = singleFlight(async (): Promise<PermissionOutcome> => {
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
});
