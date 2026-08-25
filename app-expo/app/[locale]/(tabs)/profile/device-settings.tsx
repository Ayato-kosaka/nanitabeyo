/**
 * 🚩 #1583 端末設定。
 *
 * ## なぜ設定画面から切り出したか
 * オーナー指摘（2026-08-25）:「ライトモードダークモードも、端末設定ページに
 * グルーピングするべきなきもする」。設定画面の最上段にテーマ 3 択が直置きされていて、
 * マイページから設定を開くと最初に目に入るのがテーマ選択という状態だった。
 * 使用頻度に対して位置が強すぎる。
 *
 * ## ここに置くものの基準
 * **端末に閉じて保存され、サーバーへ同期しない設定**だけを置く。
 * 表示テーマ（`theme_preference_v1`）がそれにあたる。
 * アカウントに紐づく設定（通知のカテゴリ別オン/オフ #1510 など）はここではなく設定画面に置く。
 * 同じ端末で別アカウントに入り直したとき、どちらが引き継がれるかが変わるためである。
 */
import React, { useCallback } from "react";
import { StyleSheet, ScrollView, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { ThemeSelector } from "@/features/settings/components/ThemeSelector";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";

export default function DeviceSettingsScreen() {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const router = useRouter();

	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact, router]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					title={i18n.t("Settings.deviceSettings")}
					onPressBack={handleBack}
					testID="device-settings-header"
				/>
				<ScrollView
					style={styles.scrollView}
					contentContainerStyle={styles.scrollContent}
					testID="device-settings-scroll">
					<Card style={styles.card}>
						{/* #1509 切替の効果はこの画面自体がテーマ追従なのでその場で見える */}
						<ThemeSelector />
					</Card>
					<View style={styles.spacer} />
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: { flex: 1 },
		safeArea: { flex: 1 },
		scrollView: { flex: 1 },
		scrollContent: { paddingTop: 16, paddingBottom: 32 },
		card: { padding: 0 },
		spacer: { height: 16 },
	});
