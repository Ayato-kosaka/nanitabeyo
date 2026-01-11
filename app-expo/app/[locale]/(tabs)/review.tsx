import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useAuth } from "@/contexts/AuthProvider";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { LoginbackModal } from "@/features/profile/components/LoginbackModal";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

export default function ReviewScreen() {
	const { user } = useAuth();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const {
		BlurModal: LoginBlurModal,
		open: openLoginModal,
		close: closeLoginModal,
	} = useBlurModal({ intensity: 100, zIndex: 1400 });

	useEffect(() => {
		// #644 【設計】Screen view logging
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: { screen: "review" },
		});
	}, [logFrontendEvent]);

	// #644 【設計】ゲストユーザー用：ログイン導線
	const handleLoginPress = () => {
		lightImpact();
		openLoginModal();
	};

	// #644 【設計】ログイン済みユーザー用：店舗選択（Map画面）に遷移
	const handlePostReviewPress = () => {
		lightImpact();
		logFrontendEvent({
			event_name: "review_post_button_clicked",
			error_level: "log",
			payload: {},
		});
		// #644 【設計】Map画面に遷移（店舗選択機能を利用）
		router.push("/(tabs)/map");
	};

	return (
		<SafeAreaView edges={["top", "bottom"]} style={styles.container}>
			{/* ヒーローセクション */}
			<View style={styles.heroSection}>
				<Text style={styles.heroTitle}>{i18n.t("Review.hero.title")}</Text>

				{/* #644 【設計】ヒーロー画像エリア（将来的に画像追加予定） */}
				<View style={styles.heroImagePlaceholder}>
					<Text style={styles.heroImageEmoji}>🍽️❤️✏️</Text>
				</View>
			</View>

			{/* CTA セクション */}
			<View style={styles.ctaSection}>
				{user?.is_anonymous !== false ? (
					// #644 【設計】ゲスト状態：ログイン導線を表示
					<>
						<Text style={styles.guestDescription}>{i18n.t("Review.guest.description")}</Text>
						<PrimaryButton
							onPress={handleLoginPress}
							label={i18n.t("Review.guest.loginButton")}
							borderRadius={12}
							style={styles.ctaButton}
						/>
					</>
				) : (
					// #644 【設計】ログイン済み状態：レビュー投稿導線を表示
					<PrimaryButton
						onPress={handlePostReviewPress}
						label={i18n.t("Review.authenticated.postButton")}
						borderRadius={12}
						style={styles.ctaButton}
					/>
				)}
			</View>

			{/* Login Modal */}
			<LoginBlurModal>{({ close }) => <LoginbackModal onClose={close} />}</LoginBlurModal>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFF9E6", // #644 【設計】淡い黄色背景
	},
	heroSection: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
		paddingTop: 40,
	},
	heroTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		lineHeight: 32,
		marginBottom: 32,
	},
	heroImagePlaceholder: {
		width: 200,
		height: 200,
		borderRadius: 100,
		backgroundColor: "#FFE4B5",
		justifyContent: "center",
		alignItems: "center",
		marginTop: 20,
	},
	heroImageEmoji: {
		fontSize: 64,
	},
	ctaSection: {
		paddingHorizontal: 24,
		paddingBottom: 40,
		gap: 16,
	},
	guestDescription: {
		fontSize: 16,
		color: "#666",
		textAlign: "center",
		marginBottom: 8,
	},
	ctaButton: {
		width: "100%",
	},
});
