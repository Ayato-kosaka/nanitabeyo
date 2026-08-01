import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { LoginbackModal } from "@/features/profile/components/LoginbackModal";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useLocale } from "@/hooks/useLocale";

export default function ReviewScreen() {
	const { user } = useAuth();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

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

	// const handleHeroImageError = useCallback(
	// 	(e: any) => {
	// 		const { message } = e;
	// 		logFrontendEvent({
	// 			event_name: "image_load_error",
	// 			error_level: "error",
	// 			payload: {
	// 				image: "review_hero",
	// 				errorMessage: message,
	// 				heroSource,
	// 				typeof_heroSource: typeof heroSource,
	// 			},
	// 		});
	// 	},
	// 	[logFrontendEvent, heroSource],
	// );

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
					<Image
						source={require("@/features/review/assets/review-hero.webp")}
						style={styles.heroImage}
						contentFit="contain"
					/>
				</View>
			</View>

			{/* CTA セクション */}
			<View style={styles.ctaSection}>
				<View style={styles.actionButtonContainer}>
					{/* #1092 PR4b 【修正】`user?.is_anonymous !== false` から共通判定（lib/authGuest.ts）へ寄せた。
					    旧式は is_anonymous が undefined のときもゲストへ倒れるため、通知タブ・レビュータブは
					    見えるのに、この画面だけログイン導線が出る、という食い違いになっていた */}
					{isGuestUser(user) ? (
						// #644 【設計】ゲスト状態：ログイン導線を表示
						<>
							{/* #1031 【設計】Detox から表示確認できるよう testID を追加 */}
							<Text testID="review-guest-description" style={styles.guestDescription}>
								{i18n.t("Review.guest.description")}
							</Text>
							{/* #1031 【設計】ログイン導線タップを Detox から検証できるよう testID を追加 */}
							<PrimaryButton
								testID="review-guest-login-button"
								onPress={handleLoginPress}
								label={i18n.t("Review.guest.loginButton")}
								style={styles.ctaButton}
							/>
						</>
					) : (
						// #644 【設計】ログイン済み状態：レビュー投稿導線を表示
						// #1031 【設計】投稿導線タップを Detox から検証できるよう testID を追加
						<PrimaryButton
							testID="review-post-button"
							onPress={handlePostReviewPress}
							label={i18n.t("Review.authenticated.postButton")}
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
		flex: 1,
		paddingHorizontal: 38,
	},
	title: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		lineHeight: 24,
		paddingTop: 48,
		marginBottom: 32,
	},
	heroSection: {
		flex: 2,
		justifyContent: "center",
		alignItems: "center",
	},
	heroImagePlaceholder: {
		flex: 1,
		width: "100%",
		justifyContent: "center",
		alignItems: "center",
	},
	heroImage: {
		width: "100%",
		height: "100%",
	},
	ctaSection: {
		flex: 1,
		paddingHorizontal: 24,
	},
	actionButtonContainer: {
		marginTop: 16,
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
