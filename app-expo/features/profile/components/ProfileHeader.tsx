import React from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { Edit3, MessageCircle } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

interface ProfileHeaderProps {
	profile: {
		avatar: string;
		followingCount: number;
		followersCount: number;
		totalLikes: number;
		displayName: string;
		bio: string;
		id: string;
		username: string;
	};
	isOwnProfile: boolean;
	isFollowing: boolean;
	onEditProfile: () => void;
	onFollow: () => void;
}

const formatNumber = (num: number): string => {
	if (num >= 1000000) {
		return (num / 1000000).toFixed(1).replace(/\.0$/, "") + i18n.t("Profile.numberSuffix.million");
	}
	if (num >= 1000) {
		return (num / 1000).toFixed(1).replace(/\.0$/, "") + i18n.t("Profile.numberSuffix.thousand");
	}
	return num.toString();
};

export function ProfileHeader({
	profile,
	isOwnProfile,
	isFollowing,
	onEditProfile,
	onFollow,
}: ProfileHeaderProps) {
	return (
		<Card>
			{/* Avatar and Stats */}
			<View style={styles.profileHeader}>
				<Image source={{ uri: profile.avatar }} style={styles.avatar} />

				<View style={styles.statsContainer}>
					<View style={styles.statColumn}>
						<Text style={styles.statNumber}>{formatNumber(profile.followingCount)}</Text>
						<Text style={styles.statLabel}>{i18n.t("Profile.stats.following")}</Text>
					</View>
					<View style={styles.statColumn}>
						<Text style={styles.statNumber}>{formatNumber(profile.followersCount)}</Text>
						<Text style={styles.statLabel}>{i18n.t("Profile.stats.followers")}</Text>
					</View>
					<View style={styles.statColumn}>
						<Text style={styles.statNumber}>{formatNumber(profile.totalLikes)}</Text>
						<Text style={styles.statLabel}>{i18n.t("Profile.stats.likes")}</Text>
					</View>
				</View>
			</View>

			{/* Display Name */}
			<Text style={styles.displayName}>{profile.displayName}</Text>

			{/* Bio */}
			<Text style={styles.bio}>{profile.bio}</Text>

			{/* Action Buttons */}
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
						<TouchableOpacity
							style={[styles.followButton, isFollowing && styles.followingButton]}
							onPress={onFollow}>
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
		</Card>
	);
}

const styles = StyleSheet.create({
	profileHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 16,
	},
	avatar: {
		width: 80,
		height: 80,
		borderRadius: 20,
		marginRight: 20,
		borderWidth: 3,
		borderColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
	},
	statsContainer: {
		flex: 1,
		flexDirection: "row",
		justifyContent: "space-around",
	},
	statColumn: {
		alignItems: "center",
	},
	statNumber: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 2,
		letterSpacing: -0.3,
	},
	statLabel: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
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