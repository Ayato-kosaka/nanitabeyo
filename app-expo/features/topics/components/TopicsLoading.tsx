import React from "react";
import { View, Text, StyleSheet, SafeAreaView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import i18n from "@/lib/i18n";

// Loading indicator while topics are being fetched
export const TopicsLoading = () => (
	<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.loadingContainer}>
		<SafeAreaView style={styles.loadingContent}>
			<View style={styles.loadingCard}>
				<View style={styles.loadingIconContainer}>
					<Image
						source={require("@/assets/images/icon.png")}
						style={styles.loadingIcon}
						contentFit="cover"
						transition={0}
					/>
				</View>
				<ActivityIndicator size="large" color="#5EA2FF" style={styles.loadingSpinner} />
				<Text style={styles.loadingTitle}>{i18n.t("Topics.Loading.title")}</Text>
				<Text style={styles.loadingSubtitle}>{i18n.t("Topics.Loading.subtitle")}</Text>
			</View>
		</SafeAreaView>
	</LinearGradient>
);

const styles = StyleSheet.create({
	loadingContainer: {
		flex: 1,
	},
	loadingContent: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 32,
	},
	loadingCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 24,
		padding: 32,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.15,
		shadowRadius: 16,
		elevation: 12,
		width: "100%",
		maxWidth: 320,
	},
	loadingIconContainer: {
		marginBottom: 16,
	},
	loadingIcon: {
		width: 64,
		height: 64,
	},
	loadingSpinner: {
		marginBottom: 24,
	},
	loadingTitle: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	loadingSubtitle: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
		fontWeight: "500",
	},
});
