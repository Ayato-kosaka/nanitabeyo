import * as Location from "expo-location";
import { LocationPermissionError } from "./locationPermissionError";

// #932 【設計】native側は端末の位置情報サービス自体が無効/権限がロック等で
// getCurrentPositionAsync が長時間ハングするケースがあるため、明示的にタイムアウトを設ける
const TIMEOUT_MS = 10000;

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
