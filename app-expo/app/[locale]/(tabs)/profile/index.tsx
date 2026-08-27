/*
このファイルの責務
- マイページ本体。プロフィールの要約（ProfileHeader）と、そこから開ける項目の縦リストを描画する。

#1402 【設計】この画面は 2 つのものが合流してできている。

1. **旧マイページの 4 グリッドタブを廃止した。**
   自分のレビュー / 保存した料理 / 保存した投稿 / いいねした料理 の 4 つは、新タブ
   「食べたい/食べた」（親: #1375）と役割が重複する。残すのは «いいねした投稿» と
   «保存した料理カテゴリ» の 2 つだけで、しかもタブではなく下のリストから
   `/[locale]/profile/liked` / `/[locale]/profile/saved-dish-categories` へ push する
   （グリッドの実装 LikeTab / SavedDishCategoriesTab はそのまま流用している）。

2. **独立した設定画面（profile/settings.tsx）を無くし、その項目をこのリストへ統合した。**
   設定は「たまに開く項目の一覧」でしかなく、マイページも 4 タブを失って同じ形になったため、
   歯車を挟む 1 階層が純粋な遠回りになった。旧設定画面の項目は 1 つも落としていない
   （フィードバック / レビューを書く / ブロック済み料理カテゴリ / リーガル 4 件 / ログアウト）。
   testID も `settings-*` のまま据え置いてある。「設定という画面」は無くなったが
   「設定という項目群」は残っているので、E2E から名指しできる識別子まで変える理由が無い。

3. **#1504 ただし «オン/オフのトグル» はこのリストへ直接並べない。**
   「押すと画面が開く行」と「押すとその場で値が変わる行」が同じ縦リストに混ざるうえ、
   端末設定は今後 SET-02/05/06 と増えてこの画面をトグルで埋めていく。端末に閉じた設定は
   規約カードの直上に置いた `settings-device-settings` の 1 行から
   `profile/device-settings` へ切り出してある（理由の詳細はそちらのファイル冒頭）。

⚠️ 自分/他人の出し分けを足さないこと。このアプリに他ユーザーのプロフィールを開く導線は
   存在しない（`/users/[id]` 等のルートも、フィードのアバターからの遷移も無い。#1402 で調査済み）。
   旧実装に残っていた `isOwnProfile`（常に true）とフォロー/メッセージのボタンは落とした。

⚠️ ここに BlurModal を戻さないこと。旧設定画面がフィードバック（#951）・リーガル（#1368）を
   モーダルからルートへ移し終えたのを引き継いでいる。Portal.Host が <Stack> を包む
   （app/[locale]/_layout.tsx）ため、開いた BlurModal がある状態で push すると
   遷移先が portal の下に潜って触れなくなる（#1359 で地図が踏んだ）。
*/
import React, { useCallback, useRef, useState } from "react";
import {
	View,
	Text,
	TouchableOpacity,
	StyleSheet,
	ScrollView,
	Platform,
	Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Card } from "@/components/Card";
import { SettingsMenuItem } from "@/features/settings/components/SettingsMenuItem";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ProfileHeader } from "@/features/profile/components/ProfileHeader";
import { useEnsureOwnProfileLoaded } from "@/features/profile/hooks/useEnsureOwnProfileLoaded";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { Env } from "@/constants/Env";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";
import { isGuestUser } from "@/lib/authGuest";
import type { LegalDocumentType } from "@/lib/legalRoute";
import { openExternalUrl } from "@/lib/openExternalUrl";
import type { DeleteMeResponse } from "@shared/api/v1/res";


export default function ProfileScreen() {
	// #1509 テーマ切替はこの画面から行う。切替の結果がその場のこの画面に出るよう、画面自体もテーマ対応する
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	// #1016 【設計】主要画面(マイページ)にFirebase Performance Monitoringの画面トレースを計装する。
	useScreenTrace("Profile");

	const { logout, user, isAuthResolved } = useAuth();
	const router = useRouter();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { showDialog, confirm } = useDialog();
	const { showSnackbar } = useSnackbar();
	const { callBackend } = useAPICall();
	/**
	 * #1511 アカウント削除の実行中フラグ。
	 * `ref` と `state` を両方持つのは、**押下の抑止**（同期的に読める ref）と
	 * **行の表示**（再描画が要る state）で要求が違うため。state だけだと
	 * 連打の 2 回目が再描画前に通る（DialogProvider の `confirming` と同じ考え方）。
	 */
	const isDeletingAccountRef = useRef(false);
	const [isDeletingAccount, setIsDeletingAccount] = useState(false);

	// #467 【設計】プロフィールをグローバルストアから取得し、自動ロードを実行
	useEnsureOwnProfileLoaded();
	const profile = useProfileStore((state) => state.profile);

	// #1092 【設計】auth 未確定(user === null)を「ログイン済み」と誤解させない。
	// `!user?.is_anonymous` は未確定でも true になるため、下のログアウト行が
	// 一瞬出てから消える（押せてしまう瞬間もある）。確定するまではゲスト側に寄せる。
	// 判定は通知タブ・旧設定画面と同じ共通関数（lib/authGuest.ts）へ揃えている。
	const isGuest = !isAuthResolved || isGuestUser(user);

	// ── いいね / 保存した料理カテゴリ（旧: グリッドタブ）─────────────────────────

	// #1402 【設計】旧「いいね」タブのグリッドを単独ルートとして開く
	const handleNavigateToLiked = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "profile_liked_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/(tabs)/profile/liked", params: { locale } });
	}, [lightImpact, logFrontendEvent, router, locale]);

	// #1402 【設計】旧「保存 > 料理」サブタブのグリッドを単独ルートとして開く
	const handleNavigateToSavedDishCategories = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "profile_saved_topics_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/(tabs)/profile/saved-dish-categories", params: { locale } });
	}, [lightImpact, logFrontendEvent, router, locale]);

	// ── プロフィール ────────────────────────────────────────────────────────

	// #1369 【設計】プロフィール編集は BlurModal のオーバーレイではなく «画面» へ push する
	const handleEditProfile = useCallback(() => {
		lightImpact();
		router.push({ pathname: "/[locale]/(tabs)/profile/edit", params: { locale } });
		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: {},
		});
	}, [lightImpact, locale, logFrontendEvent, router]);

	// #1359 【設計】ログインは BlurModal のオーバーレイではなく «画面» へ push する。
	// 通常はこの push が履歴を残すので、戻る導線でこの画面に復帰できる。
	// `next` は履歴を持たない着地（コールドロード / web の OAuth 全画面リダイレクト）でしか使わない保険。
	// #1402 タブが無くなったので `?tab=` を積む必要も無くなった
	const handleLogin = useCallback(() => {
		lightImpact();
		router.push({ pathname: "/[locale]/auth/login", params: { locale, next: `/${locale}/profile` } });
		logFrontendEvent({
			event_name: "login_screen_opened",
			error_level: "log",
			payload: { userId: user?.id, from: "profile" },
		});
	}, [lightImpact, logFrontendEvent, user?.id, locale, router]);

	// ── 旧設定画面から移してきた項目 ──────────────────────────────────────────

	// #1504 【設計】端末設定（この端末にだけ保存される設定）は 1 画面へ切り出してある。
	// トグルをこのリストへ直接並べると「押すと画面が開く行」と「押すと値が変わる行」が
	// 混ざるため（詳細は profile/device-settings.tsx の冒頭）。
	// #1583 【設計】なに食べよについて（応援する / 規約 / 版数）への遷移
	const handleNavigateToAbout = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_about_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/(tabs)/profile/about", params: { locale } });
	}, [lightImpact, logFrontendEvent, router, locale]);

	const handleNavigateToDeviceSettings = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_device_settings_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({
			pathname: "/[locale]/(tabs)/profile/device-settings",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, router, locale]);

	// #747 【設計】ブロック済みトピック管理画面への遷移
	const handleNavigateToBlockedDishCategories = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_blocked_topics_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({
			pathname: "/[locale]/(tabs)/profile/blocked-dish-categories",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, router, locale]);

	// #1584 【設計】自分が出した通報の履歴への遷移
	const handleNavigateToContentReports = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_content_reports_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({
			pathname: "/[locale]/(tabs)/profile/content-reports",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, router, locale]);

	// #1508 【設計】表示言語の選択画面への遷移
	// #1629 【修正】通知設定（アカウント単位。端末設定ではない）
	const handleNavigateToNotificationSettings = useCallback(() => {
		lightImpact();
		logFrontendEvent({ event_name: "settings_notifications_pressed", error_level: "log", payload: {} });
		router.push({ pathname: "/[locale]/(tabs)/profile/notifications", params: { locale } });
	}, [lightImpact, logFrontendEvent, router, locale]);

	// #1629 【仕様】アカウントを手放す操作（ログアウト / 削除）は profile/account へ切り出した。
	// ゲストには実体が無いので、この行自体を出さない（下の JSX を参照）
	const handleNavigateToAccount = useCallback(() => {
		lightImpact();
		logFrontendEvent({ event_name: "settings_account_pressed", error_level: "log", payload: {} });
		router.push({ pathname: "/[locale]/(tabs)/profile/account", params: { locale } });
	}, [lightImpact, logFrontendEvent, router, locale]);

	// #1505 【設計】自分が主催したグループ投票の一覧画面への遷移
	const handleNavigateToMyGroupVotes = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_my_group_votes_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({
			pathname: "/[locale]/(tabs)/profile/dish-category-group-votes",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, router, locale]);


	/*
	#1368 【設計】Legal ドキュメントは BlurModal をやめて `/[locale]/legal/[doc]` へ遷移する。
	この画面に開いている BlurModal は 1 つも無いので «閉じてから push» は要らない
	（理由はファイル冒頭の Portal.Host に関する注意書きを参照）。
	*/
	const handleLegalDocument = useCallback(
		(documentType: LegalDocumentType) => {
			lightImpact();
			logFrontendEvent({
				event_name: "settings_legal_document_pressed",
				error_level: "log",
				payload: { documentType },
			});

			router.push({ pathname: "/[locale]/legal/[doc]", params: { locale, doc: documentType } });
		},
		[lightImpact, logFrontendEvent, router, locale],
	);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.container} edges={["top"]}>
				{/* #1131 E2E から「ログアウト行まで送る」ためのスクロール対象。見た目には影響しない。
				    ログアウト行は最下段のカードにあり、端末によっては初期表示で画面外にいる。
				    testID は旧設定画面から据え置き（設定という «画面» は無くなったが項目群は残っている） */}
				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} testID="settings-scroll">
					{/* #1402 プロフィールの要約。ヘッダーから歯車は消えた（この画面が設定そのものになったため） */}
					{profile ? (
						<ProfileHeader
							profile={profile}
							isGuest={isGuest}
							onEditProfile={handleEditProfile}
							onLogin={handleLogin}
						/>
					) : (
						<View style={styles.headerPlaceholder}>
							<LoadingIndicator size="large" />
						</View>
					)}

					{/*
					  #1629 【仕様】1 ブロック目の並びはオーナー指示。
					  «いいねした投稿 / 保存した料理カテゴリー / グループ投票の履歴 / ブロック済みの料理カテゴリー»。
					  4 つとも «自分が過去に印を付けたもの» の棚で、性質が揃っている。
					  順番を変えるときはオーナーへ確認すること（見た目の好みではなく指示で決まっている）。
					*/}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Profile.menu.likedPosts")}
							onPress={handleNavigateToLiked}
							testID="profile-liked"
							accessibilityRole="link"
						/>
						<SettingsMenuItem
							label={i18n.t("Profile.menu.savedDishCategories")}
							onPress={handleNavigateToSavedDishCategories}
							testID="profile-saved-dish-categories"
							accessibilityRole="link"
						/>
						{/* #1505 自分が主催したグループ投票の一覧 */}
						<SettingsMenuItem
							label={i18n.t("Settings.myGroupVotes.navigationLabel")}
							onPress={handleNavigateToMyGroupVotes}
							testID="settings-my-group-votes"
							accessibilityRole="link"
						/>
						{/* #747 ブロック済みの料理カテゴリ管理 */}
						<SettingsMenuItem
							label={i18n.t("Settings.blockedDishCategories.navigationLabel")}
							onPress={handleNavigateToBlockedDishCategories}
							isLast
							testID="settings-blocked-dish-categories"
							accessibilityRole="link"
						/>
					</Card>

					{/*
					  #1629 【仕様】2 ブロック目の並びもオーナー指示。
					  «なに食べよについて / 端末設定 / あなたの報告履歴 / アカウント管理»。

					  移設したもの:
					  - ご意見・不具合 → `profile/about` の 1 ブロック目（応援するの下）
					  - 言語 → `profile/device-settings` の 1 ブロック目
					  - ログアウト / アカウント削除 → `profile/account`

					  ⚠️ ログアウトとアカウント削除をこの一覧へ戻さないこと。«押すと戻れない» 行を
					     閲覧系の行と同じ縦リストに並べない、というのがこのブロックの約束である。
					*/}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.about.navigationLabel")}
							onPress={handleNavigateToAbout}
							testID="settings-about"
							accessibilityRole="link"
						/>
						<SettingsMenuItem
							label={i18n.t("Settings.deviceSettings.navigationLabel")}
							onPress={handleNavigateToDeviceSettings}
							testID="settings-device-settings"
							accessibilityRole="link"
						/>
						{/*
						  #1629 【修正】通知設定。#1510 で作られたカードが #1583 の再編で
						  描画されなくなっていたので、専用ページを足して戻した。
						  ゲストはプッシュの受け手が居ないので出さない
						*/}
						{!isGuest && (
							<SettingsMenuItem
								label={i18n.t("Settings.notifications.navigationLabel")}
								onPress={handleNavigateToNotificationSettings}
								testID="settings-notifications"
								accessibilityRole="link"
							/>
						)}
						{/* #1584 自分が出した通報の履歴 */}
						<SettingsMenuItem
							label={i18n.t("Report.history.navigationLabel")}
							onPress={handleNavigateToContentReports}
							isLast={isGuest}
							testID="settings-content-reports"
							accessibilityRole="link"
						/>
						{/* ゲストには users 行が無く、ログアウトも削除も対象が存在しないので行ごと出さない */}
						{!isGuest && (
							<SettingsMenuItem
								label={i18n.t("Settings.account.navigationLabel")}
								onPress={handleNavigateToAccount}
								isLast
								testID="settings-account"
								accessibilityRole="link"
							/>
						)}
					</Card>

				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（contexts/ThemeProvider.tsx の useThemedStyles）。
// 値は #1402 までのリテラルをそのまま constants/Palette.ts の light へ写したもので、ライトの見た目は変わらない。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		scrollView: {
			flex: 1,
		},
		scrollContent: {
			paddingBottom: 32,
		},
		headerPlaceholder: {
			paddingVertical: 48,
			alignItems: "center",
			justifyContent: "center",
		},
		card: {
			padding: 0,
		},
	});
