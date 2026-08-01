import React from "react";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import { ProfileTabsLayout } from "@/features/profile/containers/ProfileTabsLayout";
import { SafeAreaView } from "react-native-safe-area-context";
import { useScreenTrace } from "@/hooks/useScreenTrace";

export default function ProfileScreen() {
	// #1016 【設計】主要画面(プロフィールタブ)にFirebase Performance Monitoringの画面トレースを計装する。
	useScreenTrace("Profile");
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
