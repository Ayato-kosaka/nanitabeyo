/*
このファイルの責務
- 「いいねした投稿」のグリッド（features/profile/tabs/LikeTab）を «画面» として提供する。

#1402 【設計】マイページの 4 グリッドタブ（自分のレビュー / 保存した料理 / 保存した投稿 /
いいねした料理）は、新タブ「食べたい/食べた」と役割が重複するため廃止した。
残す 2 つ（いいね・保存した料理カテゴリ）は «タブのペイン» ではなく、
マイページの縦リストから push される «独立したルート» になる。

グリッドの実装は作り直さず LikeTab をそのまま使う。タブのコンテキストの外で描画されるので、
GridList には `standalone` が渡っている（LikeTab 側のコメント参照）。

構成は `edit.tsx`（#1369）・`feedback.tsx`（#951）と同じ「Stack に push される通常画面 +
ScreenHeader で戻る」。presentation を指定しない（＝既定の card）のも同じ理由で、
Android の戻る・ブラウザバック・URL 共有がすべて Navigator の既定挙動で賄える。
*/
import React, { useCallback } from "react";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { LikeTab } from "@/features/profile/tabs/LikeTab";
import { useAppTheme } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function ProfileLikedScreen() {
	const { colors } = useAppTheme();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// 履歴が無い着地（URL 直リンク / web のリロード）ではマイページへ置き換える。
	// edit.tsx と同じ判断で、この画面は外部から行き先を受け取らないため共通関数は作らない
	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "profile_liked_screen_back_pressed",
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
					title={i18n.t("Profile.menu.likedPosts")}
					onPressBack={handleBack}
					testID="profile-liked-screen"
				/>
				<LikeTab />
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
