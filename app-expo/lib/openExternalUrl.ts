import { Platform } from "react-native";
import * as Linking from "expo-linking";

/**
 * #1121 アプリ外（ブラウザ / 外部アプリ）へ遷移する URL を開く。
 *
 * Web で `Linking.openURL()` を呼ぶと react-native-web は同一タブを遷移させるため、
 * SPA を離脱してしまい、ブラウザバックで戻ってきたときに復元に失敗して壊れる
 * （`/ja-JP/search/dish-categories` の Google Maps fallback ダイアログで発生）。
 * そのため Web では常に別タブで開き、元のページを離脱させない。
 *
 * プラットフォーム判定と `window.open` の引数は、先行して個別に分岐していた
 * `SelectedRestaurantDetails` / `useDishMediaActions` の実装に合わせている。
 *
 * ⚠️ Web でポップアップブロックされた場合 `window.open` は null を返すが、
 *    **throw も fallback もしない**。
 *    - 同一タブへ fallback すると、この関数が直そうとしている離脱そのものになる
 *    - throw すると呼び出し側の「開けた / 失敗した」ログが反転する
 *      （例: google_maps_fallback_opened → google_maps_fallback_open_failed）
 *    置換前の 2 実装も戻り値を見ていないので、その振る舞いを維持する。
 *
 * ⚠️ Web ではユーザー操作のコールスタックから同期的に呼ばれるほどブロックされにくい。
 *    呼び出し側で `await` を挟んでから呼ぶ場合は、その前提が崩れることに注意。
 */
export async function openExternalUrl(url: string): Promise<void> {
	if (Platform.OS === "web") {
		window.open(url, "_blank", "noopener,noreferrer");
		return;
	}

	await Linking.openURL(url);
}
