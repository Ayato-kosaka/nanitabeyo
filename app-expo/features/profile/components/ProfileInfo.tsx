import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { UserProfile } from "@/types";

interface ProfileInfoProps {
	profile: UserProfile;
}

/**
 * ProfileInfo コンポーネント
 * プロフィール画面の表示名とプロフィール文を表示する
 */
export function ProfileInfo({ profile }: ProfileInfoProps) {
	return (
		<>
			{/* Display Name */}
			<Text style={styles.displayName}>{profile.displayName}</Text>

			{/* Bio */}
			<Text style={styles.bio}>{profile.bio}</Text>
		</>
	);
}

const styles = StyleSheet.create({
	displayName: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	bio: {
		fontSize: 15,
		color: "#6B7280",
		lineHeight: 20,
		marginBottom: 16,
		fontWeight: "400",
	},
});
