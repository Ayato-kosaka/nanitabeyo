import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import i18n from "@/lib/i18n";
import type { Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

/*
#1629【27】この画面は **凍結リスト（EXCLUSIONS）にすら入っていない**のに未対応だった。

色を 1 つも書いていなかったからである。`assert-no-hardcoded-colors.mjs` が見るのは
«書いた色» なので、**«書かなかった色» は原理的に検出できない**（監査 B-4）。
結果、地は react-navigation の `DefaultTheme.colors.background`（`rgb(242,242,242)`）が
透け、文字は RN 既定の黒になり、**ダークモードでも «ライトの画面» が出ていた**。
*/
export default function NotFoundScreen() {
	const styles = useThemedStyles(createStyles);

	return (
		<>
			<Stack.Screen options={{ title: i18n.t("NotFound.title") }} />
			<View style={styles.container}>
				<Text style={styles.text}>{i18n.t("NotFound.message")}</Text>
				<Link href="/" style={styles.link}>
					<Text style={styles.linkText}>{i18n.t("NotFound.goHome")}</Text>
				</Link>
			</View>
		</>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			padding: 20,
			backgroundColor: c.background,
		},
		text: {
			fontSize: 20,
			fontWeight: 600,
			color: c.textPrimary,
		},
		link: {
			marginTop: 15,
			paddingVertical: 15,
		},
		linkText: {
			color: c.link,
		},
	});
