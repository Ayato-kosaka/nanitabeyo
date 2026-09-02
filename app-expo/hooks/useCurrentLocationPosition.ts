import * as Location from "expo-location";
import { LocationPermissionError } from "./locationPermissionError";

// #932 【設計】native側は端末の位置情報サービス自体が無効/権限がロック等で
// getCurrentPositionAsync が長時間ハングするケースがあるため、明示的にタイムアウトを設ける
const TIMEOUT_MS = 10000;
// #932 【修正】検索の起点用途では数分前の位置で十分なため、まず OS が保持する直近の
// 既知位置(キャッシュ)を許容して即時応答を優先する(web 実装の maximumAge と同じ方針)
const MAX_LAST_KNOWN_AGE_MS = 5 * 60 * 1000;

/**
 * 現在地の緯度経度を取得する(native実装)。
 * 権限拒否・タイムアウト・その他の失敗理由を LocationPermissionError として分類して throw する。
 */
export async function getCurrentLocationPosition(): Promise<{ latitude: number; longitude: number }> {
	const { status } = await Location.requestForegroundPermissionsAsync();
	if (status !== "granted") {
		throw new LocationPermissionError("denied", "Location permission was not granted");
	}

	try {
		// #932 【修正】新規測位を待つ前に直近の既知位置があれば即座に返す
		// (getLastKnownPositionAsync は失敗しても新規測位にフォールバックするだけなので握りつぶす)
		const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: MAX_LAST_KNOWN_AGE_MS }).catch(() => null);
		if (lastKnown) {
			return { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
		}

		const position = await Promise.race([
			Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
			new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new LocationPermissionError("timeout", "Timed out while retrieving current location"));
				}, TIMEOUT_MS);
			}),
		]);

		return { latitude: position.coords.latitude, longitude: position.coords.longitude };
	} catch (error) {
		if (error instanceof LocationPermissionError) {
			throw error;
		}
		throw new LocationPermissionError("unavailable", error instanceof Error ? error.message : String(error));
	}
}
