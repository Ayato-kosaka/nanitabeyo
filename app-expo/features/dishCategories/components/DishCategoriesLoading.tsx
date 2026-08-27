/*
料理提案（dish-categories）の取得中に出す全画面ローディング。

#1629 【修正】オーナー実機報告「ダークモードで料理提案ローディングが白い」。

地・カード・見出し・説明文がすべて **ライト固定の直書き**（白・ほぼ黒・グレー）で、
ダークにしても白いカードが白い地の上に出ていた。テーマのトークンへ差し替えている。

⚠️ この注記に色の 16 進値を書かないこと。`assert:no-hardcoded-colors` はコメントも走査するので、
   «直したことの説明» のつもりで書いた値が検査を落とす（実際に踏んだ）。

⚠️ ここに色を直書きしないこと。`assert:no-hardcoded-colors` はこのファイルを
   «理由付きで凍結中のレガシー» として見逃していたので検査が素通りしていた。
   凍結リストから外れた以上、次からは検査が止める。
*/
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

export const DishCategoriesLoading = () => {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.loadingContainer}>
			<View style={styles.loadingCard}>
				<View style={styles.loadingIconContainer}>
					<Image
						source={require("@/assets/images/icon.webp")}
						style={styles.loadingIcon}
						contentFit="cover"
						transition={0}
						cachePolicy={"memory-disk"}
					/>
				</View>
				<LoadingIndicator size="large" style={styles.loadingSpinner} />
				<Text style={styles.loadingTitle}>{i18n.t("DishCategories.Loading.title")}</Text>
				<Text style={styles.loadingSubtitle}>{i18n.t("DishCategories.Loading.subtitle")}</Text>
			</View>
		</LinearGradient>
	);
};

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		loadingContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			paddingHorizontal: 32,
		},
		loadingCard: {
			backgroundColor: colors.surface,
			borderRadius: 24,
			padding: 32,
			alignItems: "center",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.15,
			shadowRadius: 16,
			elevation: 12,
			width: "100%",
			maxWidth: 320,
		},
		loadingIconContainer: {
			marginBottom: 16,
		},
		loadingIcon: {
			width: 64,
			height: 64,
		},
		loadingSpinner: {
			marginBottom: 24,
		},
		loadingTitle: {
			fontSize: 18,
			fontWeight: "700",
			color: colors.textPrimary,
			textAlign: "center",
			marginBottom: 8,
			letterSpacing: -0.3,
		},
		loadingSubtitle: {
			fontSize: 16,
			color: colors.textSecondary,
			textAlign: "center",
			fontWeight: "500",
		},
	});
