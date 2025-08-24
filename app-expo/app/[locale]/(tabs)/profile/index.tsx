import React from "react";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import { ProfileTabsLayout } from "@/features/profile/containers/ProfileTabsLayout";

export default function ProfileScreen() {
	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<ProfileTabsLayout />
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});
