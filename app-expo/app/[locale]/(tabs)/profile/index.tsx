import React from "react";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import { ProfileTabsLayout } from "@/features/profile/containers/ProfileTabsLayout";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ProfileScreen() {
	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.container} edges={["top"]}>
				<ProfileTabsLayout />
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});
