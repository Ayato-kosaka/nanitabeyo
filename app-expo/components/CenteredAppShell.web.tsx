import { ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { CONTENT_MAX_WIDTH } from "@/constants/layout";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

/**
 * #958 【設計】walica.jp のように、web の広い画面ではアプリ全体(タブバー含む)を
 * 左右マージン付きの中央カラムへ収める。
 *
 * 設置位置が重要: `app/[locale]/_layout.tsx` で SnackbarProvider/DialogProvider/
 * Portal.Host をまとめて包む位置に設置している。react-native-paper の Dialog は
 * Portal 経由で、Snackbar は素の absolute position で描画されるが、いずれも
 * 「最も近い position 付き祖先」を基準に幅が決まるため、この位置に置くことで
 * 個別のコンポーネント側を一切変更せずに全て同じカラム幅へ自動的に収まる。
 *
 * グリッド等の px 計算は `Dimensions.get("window")` / `useWindowDimensions()` を
 * 直接見ているとこのカラム幅を追従できない(ウィンドウ実幅のまま計算されカラムから
 * はみ出す)ため、該当箇所は `hooks/useContentWidth.ts` に置き換える必要がある
 * (同じ `min(windowWidth, CONTENT_MAX_WIDTH)` を返す)。
 */
export function CenteredAppShell({ children }: { children: ReactNode }) {
	// #1509 カラムの外側もダークで白く残らないようテーマ追従にする
	const styles = useThemedStyles(createStyles);
	return (
		// #1509 【E2E】カラムの外側の面色はテーマ切替が «アプリ全体» に効いたことを見る唯一の観測点なので
		// testID を付ける（Web では data-testid として出力される）。見た目には影響しない
		<View style={styles.outer} testID="app-shell-backdrop">
			<View style={styles.inner}>{children}</View>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		outer: {
			flex: 1,
			width: "100%",
			alignItems: "center",
			backgroundColor: c.appShellBackdrop,
		},
		inner: {
			flex: 1,
			width: "100%",
			maxWidth: CONTENT_MAX_WIDTH,
			// #958 【UI】カラムと余白の境界を分かりやすくする控えめな影(walica.jp を参考)
			// #1509 影はテーマ非追従（`#000` と `#000000` は同一色）
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.06,
			shadowRadius: 24,
			elevation: 2,
		},
	});
