import { LocationPermissionError } from "./locationPermissionError";

// #932 【設計】expo-location の web 実装(ExpoLocation.web.js)は内部で navigator.permissions.query を
// 呼ぶが、環境によっては "Illegal invocation" 等の未捕捉例外を投げ、呼び出し元に何のフィードバックも
// 出ないままクラッシュしていた。web では expo-location を経由せず navigator.geolocation を直接使い、
// permissions.query は「あれば試すだけ」のオプショナル事前チェックに留める。
const TIMEOUT_MS = 10000;
// #932 【修正】maximumAge: 0 はキャッシュ位置を禁止して毎回新規測位を強制するため、
// GPS を持たないPCでは Wi-Fi/IP 測位待ちになり「以前は即反映されていたのにタイムアウトする」
// 退行を起こしていた(移行前の expo-location はキャッシュを許容)。検索の起点用途では
// 数分前の位置で十分なため、キャッシュを許容して即時応答を優先する
const MAXIMUM_AGE_MS = 5 * 60 * 1000;

/**
 * 現在地の緯度経度を取得する(web実装)。
 * 権限拒否・タイムアウト・未対応・その他の失敗理由を LocationPermissionError として分類して throw する。
 */
export async function getCurrentLocationPosition(): Promise<{ latitude: number; longitude: number }> {
	if (typeof navigator === "undefined" || !navigator.geolocation) {
		throw new LocationPermissionError("unsupported", "Geolocation API is not available in this browser");
	}

	// permissions.query は Safari 等で未実装、環境によっては例外を投げることもあるため、
	// 「拒否が確定している場合の早期判定」としてのみ使い、失敗しても getCurrentPosition 自体は実行する
	try {
		const permissionStatus = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
		if (permissionStatus?.state === "denied") {
			throw new LocationPermissionError("denied", "Geolocation permission was denied");
		}
	} catch (error) {
		if (error instanceof LocationPermissionError) {
			throw error;
		}
		// permissions API 自体の失敗(未実装・Illegal invocation 等)は無視し、getCurrentPosition の結果に委ねる
	}

	return new Promise((resolve, reject) => {
		navigator.geolocation.getCurrentPosition(
			(position) => {
				resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
			},
			(error) => {
				switch (error.code) {
					case error.PERMISSION_DENIED:
						reject(new LocationPermissionError("denied", error.message));
						break;
					case error.TIMEOUT:
						reject(new LocationPermissionError("timeout", error.message));
						break;
					case error.POSITION_UNAVAILABLE:
					default:
						reject(new LocationPermissionError("unavailable", error.message));
						break;
				}
			},
			{ enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAXIMUM_AGE_MS },
		);
	});
}
