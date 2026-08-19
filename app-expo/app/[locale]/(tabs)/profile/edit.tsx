/*
このファイルの責務
- プロフィール編集フォーム（features/profile/components/ProfileEditForm）を «画面» として提供する。
- 保存完了時・戻る操作時のどちらでも、履歴があれば戻り、無ければマイページへ置き換える。

#1369 【設計】プロフィール編集は長らく ProfileTabsLayout の中の BlurModal だった。
モーダルは「表示状態が遷移と無関係な boolean」なので、閉じる責務が呼び出し側に残り、
キーボードの管理も useBlurModal 側の KeyboardAvoidingView と OS の二重になっていた。
ルートにすると «編集 UI の寿命 = ルートの寿命» になり、その状態自体が存在しなくなる。
構成は `feedback.tsx`（#951）・`auth/login.tsx`（#1359）と同じ「Stack に push される通常画面 +
ScreenHeader で戻る」。presentation を指定しない（＝既定の card）のも同じ理由で、
Android の戻る・ブラウザバック・URL 共有がすべて Navigator の既定挙動で賄える。

⚠️ この画面に KeyboardAvoidingView / ScrollView を **置かないこと**。
`feedback.tsx` が両方を自前で持っているのは FeedbackForm がどちらも持たないからで、
ProfileEditForm の中身は `components/KeyboardAwareForm.tsx` ＝ KeyboardAvoidingView と
ScrollView の «両方» を既に持っている。ここで重ねると、モーダル時代に
useBlurModal 側と二重掛けになっていた状態（#1350 が IME 系不具合の温床として挙げた形）を
そのまま作り直すことになる。
*/
import React, { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ProfileEditForm } from "@/features/profile/components/ProfileEditForm";
import { useEnsureOwnProfileLoaded } from "@/features/profile/hooks/useEnsureOwnProfileLoaded";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function ProfileEditScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// #1369 【設計】モーダル時代はマイページ（ProfileTabsLayout）が読み込んだ profile を
	// そのまま覗いていたが、ルートは URL 直リンク・web のリロードで «単独で» 着地しうる。
	// このフックは既にストアへ載っていれば API を叩かないので、通常導線では何も増えない
	useEnsureOwnProfileLoaded();
	const profile = useProfileStore((state) => state.profile);

	/**
	 * この画面から離れる。
	 *
	 * `lib/authNext.ts` と同じ発想で `router.canGoBack()` を見るが、あちらの
	 * `resolvePostLoginTarget` は `?next=` の検証を含むログイン専用の判定なのでここでは使わない
	 * （この画面は外部から行き先を受け取らない）。新しい共通関数も作らず、画面内で閉じる。
	 */
	const leave = useCallback(() => {
		if (router.canGoBack()) {
			router.back();
			return;
		}
		// 履歴が無い着地（URL 直リンク / リロード）の保険。編集の出発点はマイページだけ
		router.replace({ pathname: "/[locale]/(tabs)/profile", params: { locale } });
	}, [locale]);

	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "profile_edit_screen_back_pressed",
			error_level: "log",
			payload: {},
		});
		leave();
	}, [lightImpact, logFrontendEvent, leave]);

	// 保存の成否・スナックバーの表示は ProfileEditForm 側が持つ。ここは成功時の離脱だけを担う
	const handleSaved = useCallback(() => {
		leave();
	}, [leave]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader
					title={i18n.t("Profile.buttons.editProfile")}
					onPressBack={handleBack}
					testID="profile-edit-screen"
				/>
				{/* #1369 【バグ】profile が載る前にフォームを mount しないこと。
				    ProfileEditForm は表示名・自己紹介の初期値を useState の初期値として «mount 時に 1 回だけ»
				    読む（IME 対策で親から流し込まない設計）ため、後から profile が届いても空欄のままになる。
				    モーダル時代は `{profile && <ProfileEditModal>}` がこの前提を保証していた。
				    ⚠️ 戻る導線はこのゲートの外に置くこと（ヘッダーは上にある）。auth/login.tsx と同じ形 */}
				{!profile ? (
					<View style={styles.loadingContainer}>
						<LoadingIndicator size="large" />
					</View>
				) : (
					<ProfileEditForm onSaved={handleSaved} />
				)}
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
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
});
