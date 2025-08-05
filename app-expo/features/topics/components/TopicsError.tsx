import React from "react";
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// Error view shown when fetching topics fails
export const TopicsError = ({ error, onBack }: { error: string; onBack: () => void }) => (
	<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.errorContainer}>
		<SafeAreaView style={styles.errorContent}>
			<View style={styles.errorCard}>
				<Text style={styles.errorText}>{error}</Text>
				<TouchableOpacity style={styles.retryButton} onPress={onBack}>
					<Text style={styles.retryButtonText}>戻る</Text>
				</TouchableOpacity>
			</View>
		</SafeAreaView>
	</LinearGradient>
);

const styles = StyleSheet.create({
	errorContainer: {
		flex: 1,
	},
	errorContent: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	errorCard: {
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
	errorText: {
		fontSize: 16,
		color: "#EF4444",
		textAlign: "center",
		marginBottom: 24,
		lineHeight: 24,
		fontWeight: "500",
	},
	retryButton: {
		backgroundColor: "#5EA2FF",
		paddingHorizontal: 24,
		paddingVertical: 16,
		borderRadius: 16,
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 12,
		elevation: 6,
	},
	retryButtonText: {
		fontSize: 16,
		color: "#FFFFFF",
		fontWeight: "600",
		letterSpacing: 0.3,
	},
});
