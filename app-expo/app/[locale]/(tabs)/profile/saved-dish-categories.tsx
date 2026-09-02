/*
このファイルの責務
- 「保存した料理カテゴリ」のグリッド（features/profile/tabs/SavedDishCategoriesTab）を «画面» として提供する。

#1402 【設計】経緯は `liked.tsx` の冒頭コメントと同じ（4 グリッドタブの廃止）。
グリッドの実装は作り直さず SavedDishCategoriesTab をそのまま使う。

#1553 【設計】ルート名は `saved-topics` から `saved-dish-categories` へ改名した（アプリ内から
topic という表現を消す）。ストアのキー（`profileSavedDishCategories`）・API
（`/v1/users/me/saved-dish-categories`）とも対応が取れている。旧ルート
（`saved-topics`）はオーナー判断で **転送も置かずに削除した**。
**画面に出る文言は「料理カテゴリ」である**（#1132 で「料理トピック」から統一済み。
e2e-web/tests/profile/blocked-categories-wording.spec.ts が旧文言の残存を見張っている）。
*/
import React, { useCallback } from "react";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { SavedDishCategoriesTab } from "@/features/profile/tabs/SavedDishCategoriesTab";
import { useAppTheme } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function ProfileSavedTopicsScreen() {
	const { colors } = useAppTheme();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "profile_saved_topics_screen_back_pressed",
			error_level: "log",
			payload: {},
		});
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace({ pathname: "/[locale]/(tabs)/profile", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					title={i18n.t("Profile.menu.savedDishCategories")}
					onPressBack={handleBack}
					testID="profile-saved-dish-categories-screen"
				/>
				<SavedDishCategoriesTab />
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	safeArea: {
		flex: 1,
	},
});
