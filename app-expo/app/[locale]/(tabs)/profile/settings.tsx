import React, { useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import * as StoreReview from "expo-store-review";
import { Card } from "@/components/Card";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { FeedbackForm } from "@/features/profile/components/FeedbackForm";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";

interface SettingsMenuItemProps {
	label: string;
	onPress: () => void;
	isLast?: boolean;
}

function SettingsMenuItem({ label, onPress, isLast }: SettingsMenuItemProps) {
	return (
		<>
			<TouchableOpacity style={styles.menuItem} onPress={onPress}>
				<Text style={styles.menuItemText}>{label}</Text>
				<ChevronRight size={20} color="#9CA3AF" />
			</TouchableOpacity>
			{!isLast && <View style={styles.separator} />}
		</>
	);
}

export default function SettingsScreen() {
	const router = useRouter();
	const locale = useLocale();
	const { logout } = useAuth();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const {
		BlurModal: FeedbackModal,
		open: openFeedbackModal,
		close: closeFeedbackModal,
	} = useBlurModal({ intensity: 100 });

	// #設定画面 【設計】フィードバック送信モーダルを起動
	const handleSendFeedback = useCallback(() => {
		lightImpact();
		openFeedbackModal();
		logFrontendEvent({
			event_name: "settings_send_feedback_pressed",
			error_level: "log",
			payload: {},
		});
	}, [lightImpact, openFeedbackModal, logFrontendEvent]);

	// #設定画面 【設計】アプリストアのレビュー画面を起動（ネイティブのみ）
	const handleLeaveReview = useCallback(async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_leave_review_pressed",
			error_level: "log",
			payload: {},
		});

		if (await StoreReview.isAvailableAsync()) {
			await StoreReview.requestReview();
		}
	}, [lightImpact, logFrontendEvent]);

	// #設定画面 【設計】Legal ドキュメント閲覧画面へ遷移（locale に応じて ja-JP or en-US を選択）
	const handleLegalDocument = useCallback(
		(documentType: "guidelines" | "terms" | "privacy" | "copyright") => {
			lightImpact();
			logFrontendEvent({
				event_name: "settings_legal_document_pressed",
				error_level: "log",
				payload: { documentType },
			});

			// locale === "ja-JP" の場合は ja-JP、それ以外は en-US
			const legalLocale = locale === "ja-JP" ? "ja-JP" : "en-US";
			router.push(`/${locale}/(tabs)/profile/legal?type=${documentType}&locale=${legalLocale}`);
		},
		[locale, router, lightImpact, logFrontendEvent],
	);

	// #設定画面 【設計】ログアウト処理を実行
	const handleLogout = useCallback(async () => {
		mediumImpact();
		logFrontendEvent({
			event_name: "settings_logout_pressed",
			error_level: "log",
			payload: {},
		});

		try {
			await logout();
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

	const handleFeedbackSubmit = useCallback(
		(data: { type: "request" | "bug"; title: string; message: string; issueNumber: number; issueUrl: string }) => {
			logFrontendEvent({
				event_name: "feedback_submitted_from_settings",
				error_level: "log",
				payload: { issueNumber: data.issueNumber },
			});
			closeFeedbackModal();
		},
		[closeFeedbackModal, logFrontendEvent],
	);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea}>
				<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
					{/* Card 1: フィードバック・レビュー */}
					<Card style={styles.card}>
						<SettingsMenuItem label={i18n.t("Settings.sendFeedback")} onPress={handleSendFeedback} />
						{/* #設定画面 【設計】Leave Review は web では非表示 */}
						{Platform.OS !== "web" && (
							<SettingsMenuItem label={i18n.t("Settings.leaveReview")} onPress={handleLeaveReview} isLast />
						)}
					</Card>

					{/* Card 2: Legal ＋ Logout */}
					<Card style={styles.card}>
						<SettingsMenuItem
							label={i18n.t("Settings.communityGuidelines")}
							onPress={() => handleLegalDocument("guidelines")}
						/>
						<SettingsMenuItem label={i18n.t("Settings.terms")} onPress={() => handleLegalDocument("terms")} />
						<SettingsMenuItem label={i18n.t("Settings.privacy")} onPress={() => handleLegalDocument("privacy")} />
						<SettingsMenuItem label={i18n.t("Settings.copyright")} onPress={() => handleLegalDocument("copyright")} />
						<SettingsMenuItem label={i18n.t("Settings.logout")} onPress={handleLogout} isLast />
					</Card>
				</ScrollView>
			</SafeAreaView>

			{/* フィードバックモーダル */}
			<FeedbackModal>
				<FeedbackForm onSubmit={handleFeedbackSubmit} onCancel={closeFeedbackModal} />
			</FeedbackModal>
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
		paddingTop: 16,
		paddingBottom: 32,
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
