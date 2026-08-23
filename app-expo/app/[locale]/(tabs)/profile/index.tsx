/*
このファイルの責務
- マイページ本体。プロフィールの要約（ProfileHeader）と、そこから開ける項目の縦リストを描画する。

#1402 【設計】この画面は 2 つのものが合流してできている。

1. **旧マイページの 4 グリッドタブを廃止した。**
   自分のレビュー / 保存した料理 / 保存した投稿 / いいねした料理 の 4 つは、新タブ
   「食べたい/食べた」（親: #1375）と役割が重複する。残すのは «いいねした投稿» と
   «保存した料理カテゴリ» の 2 つだけで、しかもタブではなく下のリストから
   `/[locale]/profile/liked` / `/[locale]/profile/saved-topics` へ push する
   （グリッドの実装 LikeTab / SavedTopicsTab はそのまま流用している）。

2. **独立した設定画面（profile/settings.tsx）を無くし、その項目をこのリストへ統合した。**
   設定は「たまに開く項目の一覧」でしかなく、マイページも 4 タブを失って同じ形になったため、
   歯車を挟む 1 階層が純粋な遠回りになった。旧設定画面の項目は 1 つも落としていない
   （フィードバック / レビューを書く / ブロック済み料理カテゴリ / リーガル 4 件 / ログアウト）。
   testID も `settings-*` のまま据え置いてある。「設定という画面」は無くなったが
   「設定という項目群」は残っているので、E2E から名指しできる識別子まで変える理由が無い。

⚠️ 自分/他人の出し分けを足さないこと。このアプリに他ユーザーのプロフィールを開く導線は
   存在しない（`/users/[id]` 等のルートも、フィードのアバターからの遷移も無い。#1402 で調査済み）。
   旧実装に残っていた `isOwnProfile`（常に true）とフォロー/メッセージのボタンは落とした。

⚠️ ここに BlurModal を戻さないこと。旧設定画面がフィードバック（#951）・リーガル（#1368）を
   モーダルからルートへ移し終えたのを引き継いでいる。Portal.Host が <Stack> を包む
   （app/[locale]/_layout.tsx）ため、開いた BlurModal がある状態で push すると
   遷移先が portal の下に潜って触れなくなる（#1359 で地図が踏んだ）。
*/
import React, { useCallback } from "react";
import {
	View,
	Text,
	TouchableOpacity,
	StyleSheet,
	ScrollView,
	Platform,
	StyleProp,
	TextStyle,
	Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { Card } from "@/components/Card";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ProfileHeader } from "@/features/profile/components/ProfileHeader";
import { SettingsToggleItem } from "@/features/settings/components/SettingsToggleItem";
import { setHapticsEnabled } from "@/features/settings/hapticsSettingsStore";
import { useHapticsEnabled } from "@/features/settings/hooks/useHapticsEnabled";
import { useEnsureOwnProfileLoaded } from "@/features/profile/hooks/useEnsureOwnProfileLoaded";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useAuth } from "@/contexts/AuthProvider";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { Env } from "@/constants/Env";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";
import { isGuestUser } from "@/lib/authGuest";
import type { LegalDocumentType } from "@/lib/legalRoute";
import { openExternalUrl } from "@/lib/openExternalUrl";

interface ProfileMenuItemProps {
	label: string;
	onPress: () => void;
	isLast?: boolean;
	textStyle?: StyleProp<TextStyle>;
	/** E2E テスト用: Web では data-testid として出力される */
	testID?: string;
	/**
	 * #950 【仕様】画面遷移(router.push)は "link"、モーダル起動・破壊的操作等は "button" として
	 * 支援技術に役割を伝える。Web では role="link"/"button" に対応する。
	 */
	accessibilityRole?: "link" | "button";
}

function ProfileMenuItem({
	label,
	onPress,
	isLast,
	textStyle,
	testID,
	accessibilityRole = "button",
}: ProfileMenuItemProps) {
	return (
		<>
			<TouchableOpacity
				style={styles.menuItem}
				onPress={onPress}
				testID={testID}
				accessibilityRole={accessibilityRole}
				accessibilityLabel={label}>
				<Text style={[styles.menuItemText, textStyle]}>{label}</Text>
				{/* #950 【仕様】装飾アイコンのため読み上げ対象から除外し、行のラベルと二重に読み上げさせない */}
				<ChevronRight size={20} color="#9CA3AF" accessibilityElementsHidden importantForAccessibility="no" />
			</TouchableOpacity>
			{!isLast && <View style={styles.separator} />}
		</>
	);
}

export default function ProfileScreen() {
	// #1016 【設計】主要画面(マイページ)にFirebase Performance Monitoringの画面トレースを計装する。
	useScreenTrace("Profile");

	const { logout, user, isAuthResolved } = useAuth();
	const router = useRouter();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { showDialog, confirm } = useDialog();
	const { showSnackbar } = useSnackbar();

	// #467 【設計】プロフィールをグローバルストアから取得し、自動ロードを実行
	useEnsureOwnProfileLoaded();
	const profile = useProfileStore((state) => state.profile);

	// #1504 端末ローカルのハプティクス設定
	const hapticsEnabled = useHapticsEnabled();

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
	const handleNavigateToSavedTopics = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "profile_saved_topics_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/(tabs)/profile/saved-topics", params: { locale } });
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

	// #1504 【設計】ハプティクスのオン/オフ切替。オンにした場合のみ確認の振動を返す
	// (オフへ切り替えたのに振動が鳴ると、切ったつもりが切れていないように見えるため)
	const handleToggleHaptics = useCallback(
		(next: boolean) => {
			void setHapticsEnabled(next);
			logFrontendEvent({
				event_name: "settings_haptics_toggled",
				error_level: "log",
				payload: { enabled: next },
			});
			if (next) lightImpact();
		},
		[lightImpact, logFrontendEvent],
	);

	// #747 【設計】ブロック済みトピック管理画面への遷移
	const handleNavigateToBlockedTopics = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_blocked_topics_pressed",
			error_level: "log",
			payload: {},
		});
		router.push({
			pathname: "/[locale]/(tabs)/profile/blocked-topics",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, router, locale]);

	// #611 【設計】ストア直接遷移（market:// / itms-apps:// → https:// フォールバック）
	const openStoreReviewPage = useCallback(async () => {
		try {
			let primaryUrl: string;
			let fallbackUrl: string;

			if (Platform.OS === "ios") {
				// iOS: itms-apps:// を優先、不可なら https:// にフォールバック
				const appStoreUrl = Env.APP_STORE_URL;
				if (!appStoreUrl) {
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: { platform: Platform.OS, reason: "missing_app_store_url" },
					});
					return;
				}
				// URL から App ID を抽出（例: https://apps.apple.com/app/id<APP_ID>）
				const appIdMatch = appStoreUrl.match(/id(\d+)/);
				if (appIdMatch) {
					primaryUrl = `itms-apps://apps.apple.com/app/id${appIdMatch[1]}?action=write-review`;
					fallbackUrl = `${appStoreUrl}?action=write-review`;
				} else {
					// App ID が見つからない場合は不正な URL と判断し、スキップ
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: {
							platform: Platform.OS,
							reason: "invalid_app_store_url_format",
							appStoreUrl,
						},
					});
					return;
				}
			} else if (Platform.OS === "android") {
				// Android: market:// を優先、不可なら https:// にフォールバック
				const playStoreUrl = Env.PLAY_STORE_URL;
				if (!playStoreUrl) {
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: { platform: Platform.OS, reason: "missing_play_store_url" },
					});
					return;
				}
				// URL からパッケージ名を抽出（例: https://play.google.com/store/apps/details?id=<package>）
				const packageMatch = playStoreUrl.match(/id=([^&]+)/);

				const packageName = packageMatch?.[1];
				// パッケージ名は Play Store の一般的なフォーマット（英数字・ドット・アンダースコア）のみ許可
				const isValidPackageName = typeof packageName === "string" && /^[A-Za-z0-9._]+$/.test(packageName);
				if (isValidPackageName) {
					primaryUrl = `market://details?id=${packageName}&showAllReviews=true`;
					fallbackUrl = `https://play.google.com/store/apps/details?id=${packageName}&showAllReviews=true`;
				} else {
					// パッケージ名が抽出・検証できない場合は不正な URL で遷移しないようにスキップ
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: {
							platform: Platform.OS,
							reason: "invalid_play_store_url_format",
							playStoreUrl,
						},
					});
					return;
				}
			} else {
				// web など他のプラットフォームでは何もしない
				logFrontendEvent({
					event_name: "settings_leave_review_open_store_skipped",
					error_level: "log",
					payload: { platform: Platform.OS, reason: "unsupported_platform" },
				});
				return;
			}

			// 優先 URL を試し、開けなければフォールバック
			const canOpenPrimary = await Linking.canOpenURL(primaryUrl);
			const urlToOpen = canOpenPrimary ? primaryUrl : fallbackUrl;

			// #1121 外部遷移は openExternalUrl へ統一する。
			// ここは上で web を早期 return しているので実行されるのはネイティブのみ
			await openExternalUrl(urlToOpen);

			logFrontendEvent({
				event_name: "settings_leave_review_open_store_success",
				error_level: "log",
				payload: { url: urlToOpen },
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "settings_leave_review_open_store_error",
				error_level: "error",
				payload: { error: (error as Error).message },
			});
			showSnackbar(i18n.t("Common.error"));
		}
	}, [logFrontendEvent, showSnackbar]);

	// #611 【設計】満足度確認ダイアログ → OK で openStoreReviewPage()
	const handleLeaveReview = useCallback(async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_leave_review_pressed",
			error_level: "log",
			payload: {},
		});

		showDialog(i18n.t("Settings.rateDialogMessage"), {
			title: i18n.t("Settings.rateDialogTitle"),
			okLabel: i18n.t("Settings.rateDialogOk"),
			cancelLabel: i18n.t("Common.cancel"),
			onConfirm: async () => {
				logFrontendEvent({
					event_name: "settings_leave_review_confirmed",
					error_level: "log",
					payload: {},
				});
				await openStoreReviewPage();
			},
		});
	}, [lightImpact, logFrontendEvent, showDialog, openStoreReviewPage]);

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

	// ログアウト処理を実行
	// #950 【仕様】破壊的操作(セッション破棄)のため、押下直後に実行せず確認ダイアログを挟む
	const handleLogout = useCallback(async () => {
		mediumImpact();
		logFrontendEvent({
			event_name: "settings_logout_pressed",
			error_level: "log",
			payload: {},
		});

		const ok = await confirm({
			title: i18n.t("Settings.logoutConfirmTitle"),
			message: i18n.t("Settings.logoutConfirmMessage"),
			confirmLabel: i18n.t("Settings.logout"),
			cancelLabel: i18n.t("Common.cancel"),
		});
		if (!ok) return;

		try {
			await logout({ scope: "local" });
			logFrontendEvent({
				event_name: "logout_success",
				error_level: "log",
				payload: {},
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "logout_error",
				error_level: "error",
				payload: { error: (error as Error).message },
			});
		}
	}, [logout, mediumImpact, logFrontendEvent, confirm]);

	// #951 【設計】フィードバック画面へ遷移(モーダル起動から変更)
	const handleSendFeedback = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_send_feedback_pressed",
			error_level: "log",
			payload: { userId: user?.id },
		});
		router.push({
			pathname: "/[locale]/(tabs)/profile/feedback",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, user?.id, router, locale]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
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

					{/* Card 1: いいね・保存（旧グリッドタブの行き先） */}
					<Card style={styles.card}>
						<ProfileMenuItem
							label={i18n.t("Profile.menu.likedPosts")}
							onPress={handleNavigateToLiked}
							testID="profile-liked"
							accessibilityRole="link"
						/>
						<ProfileMenuItem
							label={i18n.t("Profile.menu.savedDishCategories")}
							onPress={handleNavigateToSavedTopics}
							isLast
							testID="profile-saved-topics"
							accessibilityRole="link"
						/>
					</Card>

					{/* Card 1.5: 端末ローカルの一般設定。#1504 SET-01 ハプティクス。
					    以後 SET-02(通知) / SET-05(ダークモード) / SET-06(言語) もここに並ぶ想定 */}
					<Card style={styles.card}>
						<SettingsToggleItem
							label={i18n.t("Settings.hapticsEnabled")}
							value={hapticsEnabled}
							onValueChange={handleToggleHaptics}
							isLast
							testID="settings-haptics-toggle"
						/>
					</Card>

					{/* Card 2: フィードバック・レビュー・ブロック済みトピック（旧設定画面の Card 1） */}
					<Card style={styles.card}>
						<ProfileMenuItem
							label={i18n.t("Settings.sendFeedback")}
							onPress={handleSendFeedback}
							testID="settings-feedback"
							// #951 【仕様】モーダル起動から画面遷移(router.push)に変わったため link に変更(#950 の規約)
							accessibilityRole="link"
						/>
						{/* #317 【設計】Leave Review は web では非表示 */}
						{Platform.OS !== "web" && (
							<ProfileMenuItem
								label={i18n.t("Settings.leaveReview")}
								onPress={handleLeaveReview}
								testID="settings-leave-review"
								accessibilityRole="button"
							/>
						)}
						{/* #747 【設計】ブロック済みの料理カテゴリ管理画面へ遷移 */}
						<ProfileMenuItem
							label={i18n.t("Settings.blockedTopics.navigationLabel")}
							onPress={handleNavigateToBlockedTopics}
							isLast
							testID="settings-blocked-topics"
							accessibilityRole="link"
						/>
					</Card>

					{/* Card 3: Legal ＋ Logout（旧設定画面の Card 2） */}
					<Card style={styles.card}>
						{/* #1368 【仕様】モーダル起動から画面遷移(router.push)に変わったため link に変更(#950 の規約) */}
						<ProfileMenuItem
							label={i18n.t("Settings.communityGuidelines")}
							onPress={() => handleLegalDocument("guidelines")}
							testID="settings-guidelines"
							accessibilityRole="link"
						/>
						<ProfileMenuItem
							label={i18n.t("Settings.terms")}
							onPress={() => handleLegalDocument("terms")}
							testID="settings-terms"
							accessibilityRole="link"
						/>
						<ProfileMenuItem
							label={i18n.t("Settings.privacy")}
							onPress={() => handleLegalDocument("privacy")}
							testID="settings-privacy"
							accessibilityRole="link"
						/>
						<ProfileMenuItem
							label={i18n.t("Settings.copyright")}
							onPress={() => handleLegalDocument("copyright")}
							isLast={isGuest}
							testID="settings-copyright"
							accessibilityRole="link"
						/>
						{!isGuest && (
							<ProfileMenuItem
								label={i18n.t("Settings.logout")}
								onPress={handleLogout}
								testID="settings-logout"
								textStyle={{
									color: "#FF3E33",
									fontWeight: "700",
								}}
								isLast
								accessibilityRole="button"
							/>
						)}
					</Card>
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
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
	menuItem: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 16,
	},
	menuItemText: {
		fontSize: 16,
		color: "#1A1A1A",
		fontWeight: "500",
	},
	separator: {
		height: 1,
		backgroundColor: "#F3F4F6",
		marginHorizontal: 16,
	},
});
