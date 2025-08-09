import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Pencil as Edit3, MessageCircle } from "lucide-react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

interface ActionButtonsProps {
	isOwnProfile: boolean;
	isFollowing: boolean;
	onEditProfile: () => void;
	onFollow: () => void;
}

/**
 * ActionButtons コンポーネント
 * プロフィール画面のアクションボタン（編集/フォロー/メッセージ）を表示する
 */
export function ActionButtons({ isOwnProfile, isFollowing, onEditProfile, onFollow }: ActionButtonsProps) {
	return (
		<View style={styles.actionButtons}>
			{isOwnProfile ? (
				<>
					<PrimaryButton
						style={{ flex: 1 }}
						onPress={onEditProfile}
						label={i18n.t("Profile.buttons.editProfile")}
						icon={<Edit3 size={16} color="#FFFFFF" />}
					/>
				</>
			) : (
				<>
					<TouchableOpacity style={[styles.followButton, isFollowing && styles.followingButton]} onPress={onFollow}>
						<Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
							{isFollowing ? i18n.t("Profile.buttons.following") : i18n.t("Profile.buttons.follow")}
						</Text>
					</TouchableOpacity>
					<TouchableOpacity style={styles.messageButton}>
						<MessageCircle size={16} color="#FFFFFF" />
						<Text style={styles.messageButtonText}>{i18n.t("Profile.buttons.message")}</Text>
					</TouchableOpacity>
				</>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	actionButtons: {
		flexDirection: "row",
		gap: 8,
	},
	followButton: {
		flex: 1,
		backgroundColor: "#5EA2FF",
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderRadius: 16,
		alignItems: "center",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 6,
	},
	followingButton: {
		backgroundColor: "#6B7280",
	},
	followButtonText: {
		fontSize: 15,
		fontWeight: "600",
		color: "#FFFFFF",
		letterSpacing: 0.2,
	},
	followingButtonText: {
		color: "#FFFFFF",
	},
	messageButton: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#6B7280",
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderRadius: 16,
		gap: 6,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	messageButtonText: {
		fontSize: 15,
		fontWeight: "600",
		color: "#FFFFFF",
		letterSpacing: 0.2,
	},
});
