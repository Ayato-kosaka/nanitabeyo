import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { ArrowLeft, Settings, Share } from "lucide-react-native";
import { router } from "expo-router";
import { UserProfile } from "@/types";

interface ProfileHeaderProps {
	profile: UserProfile;
	isOwnProfile: boolean;
	onShareProfile: () => void;
}

/**
 * ProfileHeader コンポーネント
 * プロフィール画面のヘッダー部分（戻るボタン、ユーザー名、設定・共有ボタン）を表示する
 */
export function ProfileHeader({ profile, isOwnProfile, onShareProfile }: ProfileHeaderProps) {
	return (
		<View style={styles.header}>
			{!isOwnProfile && (
				<TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
					<ArrowLeft size={24} color="#1A1A1A" />
				</TouchableOpacity>
			)}
			<Text style={styles.headerTitle}>{profile.username}</Text>
			<View style={{ flexDirection: "row", gap: 8 }}>
				<TouchableOpacity style={styles.shareButton} onPress={onShareProfile}>
					<Share size={24} color="#666" />
				</TouchableOpacity>
				<TouchableOpacity style={styles.settingButton}>
					<Settings size={24} color="#666" />
				</TouchableOpacity>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	backButton: {
		padding: 4,
		borderRadius: 12,
		backgroundColor: "rgba(255, 255, 255, 0.1)",
	},
	headerTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
	},
	settingButton: {
		padding: 4,
	},
	shareButton: {
		padding: 4,
	},
});
