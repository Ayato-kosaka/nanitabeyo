/*
店舗提案（restaurant）の取得中に出す全画面ローディング。

#1629 【修正】オーナー実機報告「料理提案画面自体がダークモードに対応してない」の一連。
地・カード・見出し・説明文がライト固定の直書きで、ダークでも白いカードが白い地の上に出ていた。
兄弟の DishCategoriesLoading.tsx と同じトークンへ差し替えている。

⚠️ この注記に色の 16 進値を書かないこと。`assert:no-hardcoded-colors` はコメントも走査する。
*/
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

// #420 【仕様】店舗5件のローディング画面 - 必要データ（リスト＋サムネイル最低1枚）事前読み込み未完了の場合のみ表示
export const RestaurantLoading = () => {
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
				<Text style={styles.loadingTitle}>{i18n.t("Restaurant.Loading.title")}</Text>
				<Text style={styles.loadingSubtitle}>{i18n.t("Restaurant.Loading.subtitle")}</Text>
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
