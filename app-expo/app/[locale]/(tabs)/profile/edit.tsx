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
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ProfileEditForm } from "@/features/profile/components/ProfileEditForm";
import { useEnsureOwnProfileLoaded } from "@/features/profile/hooks/useEnsureOwnProfileLoaded";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

export default function ProfileEditScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);

	// #1369 【設計】モーダル時代はマイページ（ProfileTabsLayout）が読み込んだ profile を
	// そのまま覗いていたが、ルートは URL 直リンク・web のリロードで «単独で» 着地しうる。
	//
	// ⚠️ 「既にストアへ載っていれば API を叩かない」ではない（PR #1392 のレビュー S-2 で実測）。
	// このフックはセッション変更 effect が **mount 時に無条件で** resetProfile() するため、
	// この画面へ入るたびに必ず 1 回は取得が走る。«変わったときだけリセット» へ絞る話は別 Issue
	const { hasLoadFailed, retry } = useEnsureOwnProfileLoaded();
	const profile = useProfileStore((state) => state.profile);

	// #1387 【バグ】取得が 404 «以外» で失敗（通信断・500 など）すると profile は null のまま
	// 決着する。`profile` だけを見ていると、その人の画面はスピナーが永久に回り続けていた。
	//
	// ⚠️ `isProfileResolved && !profile` で «失敗» を推論しないこと（PR #1392 のレビュー B-1）。
	// `isProfileResolved` はフック固有の state だが `profile` は共有ストアなので、第三者が
	// ストアを空にした瞬間（セッション切替 / 別画面のフックの mount）に «失敗していないのに
	// エラー画面» が出る。しかもこの画面は元がスピナーだったので、推論のままだと
	// 「一瞬スピナー」が「一瞬エラー」へ悪化する。フックが持つ実際の失敗だけを見る
	// `&& !profile` を足してあるのは B-1 の «裏返し» を塞ぐため（PR #1392 の再レビュー N-1）。
	// hasLoadFailed は «他者がプロフィールを載せた» ことでは下りないので、失敗したあとに
	// 別の消費者が取得に成功すると «データがあるのにエラー画面» が残りうる。
	// ⚠️ これは «ストアから失敗を推論する» のとは逆向きである。失敗の判定はあくまで
	// hasLoadFailed が持ち、profile はそれを «取り消す» 方向にしか効かないので B-1 は再発しない
	const hasFailed = hasLoadFailed && !profile;

	/**
	 * この画面から離れる。
	 *
	 * `lib/authNext.ts` と同じ発想で «戻れるか» を見るが、あちらの
	 * `resolvePostLoginTarget` は `?next=` の検証を含むログイン専用の判定なのでここでは使わない
	 * （この画面は外部から行き先を受け取らない）。新しい共通関数も作らず、画面内で閉じる。
	 */
	/**
	 * #1404 【バグ】`canGoBack()` ではなく **`canDismiss()`** を見ること。
	 *
	 * `canGoBack()` は React Navigation のナビゲーション状態を «親までさかのぼって» 見る。
	 * `(tabs)/_layout.tsx` は `initialRouteName="search"` を指定しているので、この画面へ
	 * URL 直リンクで着地すると **タブナビゲータが «検索へ戻れる»** と答え、`canGoBack()` は true になる。
	 * その結果、下の replace（親へ倒す保険）が一度も働かず、戻るは検索タブへ飛ぶ。
	 *
	 * `canDismiss()` は «スタックが 2 枚以上あるか» だけを見る（expo-router の
	 * build/global-state/routing.js: `state.type === 'stack' && state.routes.length > 1`）。
	 * タブ履歴もブラウザ履歴も数えないので、
	 *   - 通常導線（親から push）→ true → back で親へ戻る
	 *   - 直リンク着地（スタックは自分 1 枚）→ false → 親へ replace
	 * のどちらも意図どおりになる。
	 *
	 * ⚠️ `(tabs)` の外にあるルート（`/legal/[doc]` / `/auth/login`）はルート Stack が 1 枚なので
	 * `canGoBack()` でも同じ答えになる。実際 E2E Web run 32243079269 で落ちたのは
	 * `(tabs)` 配下の 2 件だけで、legal の同型テストは緑だった。
	 */
	const leave = useCallback(() => {
		if (router.canDismiss()) {
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

	// #1387 再試行。押せるのは決着後（= エラー表示が出ているとき）だけなので、
	// 読み込み中の二重取得にはならない（フックの JSDoc 参照）
	// ⚠️ ここで lightImpact() を呼ばないこと（PR #1392 のレビュー T-1）。PrimaryButton は
	// handlePress の中で自分で鳴らすので、二重になる。ScreenHeader は鳴らさないため handleBack 側は必要
	const handleRetry = useCallback(() => {
		logFrontendEvent({
			event_name: "profile_edit_load_retry_pressed",
			error_level: "log",
			payload: {},
		});
		retry();
	}, [logFrontendEvent, retry]);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
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
				{hasFailed ? (
					/* #1387 決着済みで取れなかった状態。ここを出さないとスピナーのままになる。
					   離脱はヘッダーの戻る（このゲートの外）で足りるので、ここには «やり直す» 手段だけを置く */
					<View style={styles.messageContainer} testID="profile-edit-error">
						<Text style={styles.errorText}>{i18n.t("Common.errors.unexpected")}</Text>
						<PrimaryButton label={i18n.t("Common.retry")} onPress={handleRetry} testID="profile-edit-retry-button" />
					</View>
				) : !profile ? (
					<View style={styles.messageContainer}>
						<LoadingIndicator size="large" />
					</View>
				) : (
					<ProfileEditForm onSaved={handleSaved} />
				)}
			</SafeAreaView>
		</LinearGradient>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		safeArea: {
			flex: 1,
		},
		messageContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			gap: 16,
			paddingHorizontal: 32,
		},
		errorText: {
			fontSize: 15,
			color: c.textSecondary,
			textAlign: "center",
		},
	});
