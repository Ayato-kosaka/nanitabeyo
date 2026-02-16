import React, { useCallback, useEffect, useState } from "react";
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
import { ChevronRight, X } from "lucide-react-native";
import { Card } from "@/components/Card";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { FeedbackForm } from "@/features/profile/components/FeedbackForm";
import { LegalDocument } from "@/features/settings/components/LegalDocument";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useDialog } from "@/contexts/DialogProvider";
import { Env } from "@/constants/Env";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { supabase } from "@/lib/supabase";
import { deleteReaction } from "@/lib/reactions";
import { useLocale } from "@/hooks/useLocale";

interface SettingsMenuItemProps {
	label: string;
	onPress: () => void;
	isLast?: boolean;
	textStyle?: StyleProp<TextStyle>;
}

function SettingsMenuItem({ label, onPress, isLast, textStyle }: SettingsMenuItemProps) {
	return (
		<>
			<TouchableOpacity style={styles.menuItem} onPress={onPress}>
				<Text style={[styles.menuItemText, textStyle]}>{label}</Text>
				<ChevronRight size={20} color="#9CA3AF" />
			</TouchableOpacity>
			{!isLast && <View style={styles.separator} />}
		</>
	);
}

type BlockedTopicChip = { id: string; label: string };

export default function SettingsScreen() {
	const { logout, user } = useAuth();
	const { locale } = useLocale();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { showDialog } = useDialog();
	const { showSnackbar } = useSnackbar();
	const [blockedTopics, setBlockedTopics] = useState<BlockedTopicChip[]>([]);
	const [isLoadingBlockedTopics, setIsLoadingBlockedTopics] = useState(false);
	const [selectedLegalDocument, setSelectedLegalDocument] = useState<
		"guidelines" | "terms" | "privacy" | "copyright" | null
	>(null);
	const {
		BlurModal: FeedbackModal,
		open: openFeedbackModal,
		close: closeFeedbackModal,
	} = useBlurModal({ intensity: 100 });
	const {
		BlurModal: LegalDocumentModal,
		open: openLegalDocumentModal,
		close: closeLegalDocumentModal,
	} = useBlurModal({ intensity: 100 });


	const fetchBlockedTopics = useCallback(async () => {
		try {
			setIsLoadingBlockedTopics(true);
			const { data: blockedReactions, error: reactionsError } = await supabase
				.from("reactions")
				.select("target_id")
				.eq("target_type", "dish_categories")
				.eq("action_type", "block")
				.order("created_at", { ascending: false });

			if (reactionsError) throw reactionsError;

			const uniqueIds = Array.from(new Set((blockedReactions || []).map((item) => item.target_id).filter(Boolean)));
			if (uniqueIds.length === 0) {
				setBlockedTopics([]);
				return;
			}

			const { data: categories, error: categoriesError } = await supabase
				.from("dish_categories")
				.select("id,label_en,labels")
				.in("id", uniqueIds);

			if (categoriesError) throw categoriesError;

			const localeCode = locale.split("-")[0];
			const categoryById = new Map(
				(categories || []).map((category) => {
					const labels = (category.labels || {}) as Record<string, string>;
					const label = labels[localeCode] || labels.en || category.label_en || category.id;
					return [category.id, label] as const;
				}),
			);

			setBlockedTopics(
				uniqueIds.map((id) => ({ id, label: categoryById.get(id) || id })),
			);
		} catch (error) {
			console.error("failed to fetch blocked topics", error);
			showSnackbar(i18n.t("Common.error"));
		} finally {
			setIsLoadingBlockedTopics(false);
		}
	}, [locale, showSnackbar]);

	useEffect(() => {
		fetchBlockedTopics().catch(() => undefined);
	}, [fetchBlockedTopics]);

	const handleUnblockTopic = useCallback((topic: BlockedTopicChip) => {
		showDialog(i18n.t("Settings.blockedTopics.unblockMessage"), {
			title: i18n.t("Settings.blockedTopics.unblockTitle"),
			okLabel: i18n.t("Settings.blockedTopics.unblockConfirm"),
			cancelLabel: i18n.t("Common.cancel"),
			onConfirm: async () => {
				try {
					await deleteReaction({
						target_type: "dish_categories",
						target_id: topic.id,
						action_type: "block",
					});
					setBlockedTopics((prev) => prev.filter((item) => item.id !== topic.id));
					showSnackbar(i18n.t("Settings.blockedTopics.unblocked"));
				} catch (error) {
					console.error("failed to unblock topic", error);
					showSnackbar(i18n.t("Common.error"));
				}
			},
		});
	}, [showDialog, showSnackbar]);

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

			await Linking.openURL(urlToOpen);

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
	}, [logFrontendEvent]);

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

	// Legal ドキュメント閲覧をモーダルで表示
	const handleLegalDocument = useCallback(
		(documentType: "guidelines" | "terms" | "privacy" | "copyright") => {
			lightImpact();
			logFrontendEvent({
				event_name: "settings_legal_document_pressed",
				error_level: "log",
				payload: { documentType },
			});

			setSelectedLegalDocument(documentType);
			openLegalDocumentModal();
		},
		[lightImpact, logFrontendEvent, openLegalDocumentModal],
	);

	// ログアウト処理を実行
	const handleLogout = useCallback(async () => {
		mediumImpact();
		logFrontendEvent({
			event_name: "settings_logout_pressed",
			error_level: "log",
			payload: {},
		});

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
	}, [logout, mediumImpact, logFrontendEvent]);

	// フィードバック送信モーダルを起動
	const handleSendFeedback = useCallback(() => {
		lightImpact();
		openFeedbackModal();
		logFrontendEvent({
			event_name: "settings_send_feedback_pressed",
			error_level: "log",
			payload: { userId: user?.id },
		});
	}, [lightImpact, openFeedbackModal, logFrontendEvent, user?.id]);

	const handleFeedbackSubmit = useCallback(
		(_data: { type: "request" | "bug"; title: string; message: string; issueNumber: number; issueUrl: string }) => {
			showSnackbar(i18n.t("Feedback.success.submitted"));
			closeFeedbackModal();
		},
		[closeFeedbackModal, showSnackbar],
	);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={["top"]}>
				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
					<View style={styles.header}>
						<Text style={styles.title}>{i18n.t("Settings.title")}</Text>
					</View>

					{/* Card 1: フィードバック・レビュー */}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.sendFeedback")}
							onPress={handleSendFeedback}
							isLast={Platform.OS === "web"}
						/>
						{/* #317 【設計】Leave Review は web では非表示 */}
						{Platform.OS !== "web" && (
							<SettingsMenuItem label={i18n.t("Settings.leaveReview")} onPress={handleLeaveReview} isLast />
						)}
						<View style={styles.separator} />
						<View style={styles.blockedTopicsSection}>
							<Text style={styles.blockedTopicsTitle}>{i18n.t("Settings.blockedTopics.title")}</Text>
							{isLoadingBlockedTopics ? (
								<Text style={styles.blockedTopicsEmpty}>{i18n.t("Settings.blockedTopics.loading")}</Text>
							) : blockedTopics.length === 0 ? (
								<Text style={styles.blockedTopicsEmpty}>{i18n.t("Settings.blockedTopics.empty")}</Text>
							) : (
								<View style={styles.blockedTopicsChips}>
									{blockedTopics.map((topic) => (
										<View key={topic.id} style={styles.blockedTopicChip}>
											<Text style={styles.blockedTopicChipText}>{topic.label}</Text>
											<TouchableOpacity
												style={styles.blockedTopicChipClose}
												onPress={() => handleUnblockTopic(topic)}
												accessibilityRole="button">
												<X size={12} color="#6B7280" />
											</TouchableOpacity>
										</View>
									))}
								</View>
							)}
						</View>
					</Card>

					{/* Card 2: Legal ＋ Logout */}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.communityGuidelines")}
							onPress={() => handleLegalDocument("guidelines")}
						/>
						<SettingsMenuItem label={i18n.t("Settings.terms")} onPress={() => handleLegalDocument("terms")} />
						<SettingsMenuItem label={i18n.t("Settings.privacy")} onPress={() => handleLegalDocument("privacy")} />
						<SettingsMenuItem
							label={i18n.t("Settings.copyright")}
							onPress={() => handleLegalDocument("copyright")}
							isLast={!!user?.is_anonymous}
						/>
						{!user?.is_anonymous && (
							<SettingsMenuItem
								label={i18n.t("Settings.logout")}
								onPress={handleLogout}
								textStyle={{
									color: "#FF3E33",
									fontWeight: "700",
								}}
								isLast
							/>
						)}
					</Card>
				</ScrollView>
			</SafeAreaView>

			{/* フィードバックモーダル */}
			<FeedbackModal>
				<FeedbackForm onSubmit={handleFeedbackSubmit} onCancel={closeFeedbackModal} />
			</FeedbackModal>

			{/* Legal ドキュメントモーダル */}
			<LegalDocumentModal>
				{selectedLegalDocument && <LegalDocument documentType={selectedLegalDocument} />}
			</LegalDocumentModal>
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
	scrollView: {
		flex: 1,
	},
	scrollContent: {
		paddingBottom: 32,
	},
	header: {
		paddingHorizontal: 32,
		paddingVertical: 12,
	},
	title: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
		flex: 1,
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
	blockedTopicsSection: {
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	blockedTopicsTitle: {
		fontSize: 14,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	blockedTopicsEmpty: {
		fontSize: 13,
		color: "#6B7280",
	},
	blockedTopicsChips: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
	},
	blockedTopicChip: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#F3F4F6",
		borderRadius: 999,
		paddingLeft: 12,
		paddingRight: 8,
		paddingVertical: 6,
		gap: 6,
	},
	blockedTopicChipText: {
		fontSize: 13,
		color: "#374151",
		fontWeight: "500",
	},
	blockedTopicChipClose: {
		width: 18,
		height: 18,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 9,
		backgroundColor: "#E5E7EB",
	},

});
