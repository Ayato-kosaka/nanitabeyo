import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, StyleProp, TextStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";
import * as StoreReview from "expo-store-review";
import { Card } from "@/components/Card";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { FeedbackForm } from "@/features/profile/components/FeedbackForm";
import { LegalDocument } from "@/features/settings/components/LegalDocument";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { SafeAreaView } from "react-native-safe-area-context";

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

export default function SettingsScreen() {
	const { logout, user } = useAuth();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
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

	// アプリストアのレビュー画面を起動（ネイティブのみ）
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
		(data: { type: "request" | "bug"; title: string; message: string; issueNumber: number; issueUrl: string }) => {
			closeFeedbackModal();
		},
		[closeFeedbackModal, logFrontendEvent],
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
});
