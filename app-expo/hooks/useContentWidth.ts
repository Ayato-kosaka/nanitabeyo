import { Platform, useWindowDimensions } from "react-native";
import { CONTENT_MAX_WIDTH } from "@/constants/layout";

/**
 * #958 【設計】グリッド等の幅計算に使う「実際に描画されているコンテンツ幅」を返す。
 *
 * 背景: web は `components/CenteredAppShell.web.tsx` によりアプリ全体が
 * `maxWidth: CONTENT_MAX_WIDTH` の中央カラムに収まるが、`Dimensions.get("window")` /
 * `useWindowDimensions()` は依然としてブラウザウィンドウの実幅(例: 1280px)を返し続ける。
 * この2つが一致しないと、グリッドアイテムがカラム幅を無視して過大に計算され、
 * カラムの外へはみ出す(横スクロール・レイアウト崩れ)。
 *
 * このフックは CenteredAppShell が CSS で行っているのと同じ `min(windowWidth, CONTENT_MAX_WIDTH)`
 * のクランプをそのまま返すことで、両者を常に一致させる。onLayout 計測を使わないのは、
 * 初回描画後まで正しい値が得られず一瞬だけ誤ったサイズで描画される(レイアウトの一瞬のガタつき)
 * のを避けるため — このフックは初回描画から正しい値を返せる。
 *
 * native では CenteredAppShell が何もしない(全画面がそのままカラム)ため、
 * 常に実際のウィンドウ幅をそのまま返す。
 */
export function useContentWidth(): number {
	const { width } = useWindowDimensions();
	if (Platform.OS !== "web") return width;
	return Math.min(width, CONTENT_MAX_WIDTH);
}
