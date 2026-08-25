/*
このファイルの責務
- 保存した料理カテゴリの «地点検索» を画面として提供する（中身は
  features/profile/containers/SavedDishCategoryLocationSearch）。
- 検索対象のカテゴリを URL パラメータ（dishCategoryId / dishCategoryLabelEn）で受け取る。
- 戻る導線（ScreenHeader / ハードウェアバック）でマイページへ帰す。

#1369 【設計】以前は SavedDishCategoriesTab の中の BlurModal だった。地点オートコンプリートを
BlurModal の中に置いていた唯一の画面で、#528（候補をタップするとキーボードだけ閉じて
選択が反応しない）の当事者そのもの。ルートにすればモーダル側の KeyboardAvoidingView が
消え、キーボードを触るのは OS と LocationAutocomplete だけになる。

パスをマイページ配下（`profile/saved-dish-category-location`）に置いたのは、遷移先の検索結果
（`profile/search-results`）と同じく «マイページのタブ内に留まる» のが #1133 の要件だから。
presentation は指定しない（＝既定の card）。`feedback.tsx`（#951）・`auth/login.tsx`（#1359）と
同じ構成で、Android の戻る・ブラウザバックが Navigator の既定挙動で賄える。

⚠️ この画面に KeyboardAvoidingView を足さないこと。足すと «モーダルと OS の二重管理» という
#1350 が問題にした形をそのまま作り直すことになる。入力欄は 1 つで、候補パネルは
LocationAutocomplete が自分の下に描くため、キーボードに隠れて困る要素も無い。
*/
import React, { useCallback } from "react";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { SavedDishCategoryLocationSearch } from "@/features/profile/containers/SavedDishCategoryLocationSearch";
import { useAppTheme } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function SavedTopicLocationScreen() {
	const { colors } = useAppTheme();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { dishCategoryId, dishCategoryLabelEn } = useLocalSearchParams<{ dishCategoryId?: string; dishCategoryLabelEn?: string }>();

	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "saved_topic_location_screen_back_pressed",
			error_level: "log",
			payload: { dishCategoryId },
		});

		if (router.canDismiss()) {
			router.back();
			return;
		}
		// 履歴が無い着地（URL 直リンク / リロード）の保険。出発点は保存した料理カテゴリの一覧だけ。
		// #1402 マイページの 4 グリッドタブ廃止により `?tab=saved-dish-categories` は «単独のルート» になった
		router.replace({ pathname: "/[locale]/(tabs)/profile/saved-dish-categories", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale, dishCategoryId]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					title={i18n.t("Search.locationModal.title")}
					onPressBack={handleBack}
					testID="saved-dish-category-location-screen"
				/>
				<SavedDishCategoryLocationSearch dishCategoryId={dishCategoryId} dishCategoryLabelEn={dishCategoryLabelEn} />
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
