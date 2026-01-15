import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { Image } from "expo-image";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useAuth } from "@/contexts/AuthProvider";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { LoginbackModal } from "@/features/profile/components/LoginbackModal";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useLocale } from "@/hooks/useLocale";

const HERO_IMAGE_HEIGHT = 400;
const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function ReviewScreen() {
	const { user } = useAuth();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

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

	// #644 【設計】ログイン済みユーザー用：店舗選択画面に遷移
	const handlePostReviewPress = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "review_post_button_clicked",
			error_level: "log",
			payload: {},
		});
		// #644 【設計】レビュー用の店舗選択画面に遷移
		router.push({
			pathname: "/[locale]/(tabs)/review/selectRestaurant",
			params: {
				locale,
			},
		});
	}, [lightImpact, logFrontendEvent, locale]);

	return (
		<SafeAreaView edges={["top", "bottom"]} style={styles.container}>
			{/* タイトル セクション */}
			<View style={styles.titleSection}>
				<Text style={styles.title}> {i18n.t("Review.hero.title")}</Text>
			</View>

			{/* ヒーローセクション */}
			<View style={styles.heroSection}>
				<View style={styles.heroImagePlaceholder}>
					<Image source={require("@/features/review/assets/review-hero.webp")} style={styles.heroImage} />
				</View>
			</View>

			{/* CTA セクション */}
			<View style={styles.ctaSection}>
				<View style={styles.actionButtonContainer}>
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
			</View>

			{/* Login Modal */}
			<LoginBlurModal>{({ close }) => <LoginbackModal onClose={close} />}</LoginBlurModal>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fbeedd", // #644 【設計】淡い黄色背景
	},
	titleSection: {
		height: (SCREEN_HEIGHT - HERO_IMAGE_HEIGHT) * 0.5,
		paddingTop: 48,
		paddingHorizontal: 38,
	},
	title: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		lineHeight: 24,
		marginBottom: 32,
	},
	heroSection: {
		flex: 1,
		height: HERO_IMAGE_HEIGHT,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	heroImagePlaceholder: {
		width: HERO_IMAGE_HEIGHT,
		height: HERO_IMAGE_HEIGHT,
		justifyContent: "center",
		alignItems: "center",
	},
	heroImage: {
		height: HERO_IMAGE_HEIGHT,
		width: HERO_IMAGE_HEIGHT,
		resizeMode: "contain",
	},
	ctaSection: {
		height: (SCREEN_HEIGHT - HERO_IMAGE_HEIGHT) * 0.5,
		paddingHorizontal: 24,
	},
	actionButtonContainer: {
		marginTop: 64,
	},
	guestDescription: {
		fontSize: 16,
		color: "#666",
		textAlign: "center",
		marginBottom: 16,
	},
	ctaButton: {
		width: "100%",
	},
});
