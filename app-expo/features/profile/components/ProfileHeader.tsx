import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, Settings, Share, Pencil as Edit3, MessageCircle } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

interface ProfileHeaderProps {
	profile: {
		id: string;
		username: string;
		displayName: string;
		bio: string;
		avatar: string;
		followingCount: number;
		followersCount: number;
		totalLikes: number;
	};
	isOwnProfile: boolean;
	isGuest?: boolean;
	isFollowing?: boolean;
	onLayout?: (event: LayoutChangeEvent) => void;
	onBack?: () => void;
	onShare?: () => void;
	onSettings?: () => void;
	onEditProfile?: () => void;
	onFollow?: () => void;
	onMessage?: () => void;
	onFeedback?: () => void;
}

const formatNumber = (num: number): string => {
	if (num >= 1000000) {
		return `${(num / 1000000).toFixed(1)}M`;
	}
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1)}K`;
	}
	return num.toString();
};

export function ProfileHeader({
	profile,
	isOwnProfile,
	isGuest = false,
	isFollowing = false,
	onLayout,
	onBack,
	onShare,
	onSettings,
	onEditProfile,
	onFollow,
	onMessage,
	onFeedback,
}: ProfileHeaderProps) {
	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} onLayout={onLayout} pointerEvents="box-none" style={{ zIndex: 1 }}>
			{/* Header Navigation */}
			<View style={styles.header} pointerEvents="box-none">
				{!isOwnProfile && (
					<TouchableOpacity onPress={onBack || (() => {})} style={styles.backButton}>
						<ArrowLeft size={24} color="#1A1A1A" />
					</TouchableOpacity>
				)}
				<Text style={styles.headerTitle}>{profile.username}</Text>
				<View style={{ flexDirection: "row", gap: 8 }}>
					<TouchableOpacity style={styles.shareButton} onPress={onShare || (() => {})}>
						<Share size={24} color="#666" />
					</TouchableOpacity>
					<TouchableOpacity style={styles.settingButton} onPress={onSettings || (() => {})}>
						<Settings size={24} color="#666" />
					</TouchableOpacity>
				</View>
			</View>

			{/* Profile Info Card */}
			<View style={styles.cardContainer} pointerEvents="box-none">
				<Card style={styles.card} pointerEvents="box-none">
					{/* Avatar and Stats */}
					<View style={[styles.profileHeader]} pointerEvents="none">
						<Image
							source={isGuest ? require("@/assets/images/icon.png") : { uri: profile.avatar }}
							style={styles.avatar}
							contentFit="cover"
							transition={0}
							cachePolicy={"memory-disk"}
						/>

						{!isGuest && (
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
						)}
					</View>

					{/* Display Name */}
					<Text style={[styles.displayName]} pointerEvents="none">
						{profile.displayName}
					</Text>

					{/* Bio */}
					<Text style={[styles.bio]} pointerEvents="none">
						{isGuest ? i18n.t("Profile.guestBio") : profile.bio}
					</Text>

					{/* Action Buttons */}
					<View style={styles.actionButtons}>
						{isOwnProfile && !isGuest ? (
							<PrimaryButton
								style={{ flex: 1 }}
								onPress={onEditProfile || (() => {})}
								label={i18n.t("Profile.buttons.editProfile")}
								icon={<Edit3 size={16} color="#FFFFFF" />}
							/>
						) : isGuest ? (
							<PrimaryButton
								style={{ flex: 1 }}
								onPress={onFeedback || (() => {})}
								label={i18n.t("Profile.buttons.sendFeedback")}
							/>
						) : (
							<>
								<TouchableOpacity
									style={[styles.followButton, isFollowing && styles.followingButton]}
									onPress={onFollow || (() => {})}>
									<Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
										{isFollowing ? i18n.t("Profile.buttons.following") : i18n.t("Profile.buttons.follow")}
									</Text>
								</TouchableOpacity>
								<TouchableOpacity style={styles.messageButton} onPress={onMessage || (() => {})}>
									<MessageCircle size={16} color="#FFFFFF" />
									<Text style={styles.messageButtonText}>{i18n.t("Profile.buttons.message")}</Text>
								</TouchableOpacity>
							</>
						)}
					</View>
				</Card>
			</View>
		</LinearGradient>
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
	cardContainer: {},
	card: {
		alignItems: "center",
	},
	profileHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 16,
	},
	avatar: {
		width: 80,
		height: 80,
		borderRadius: 20,
		borderWidth: 3,
		borderColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
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
		textAlign: "center",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	bio: {
		fontSize: 15,
		color: "#6B7280",
		textAlign: "center",
		lineHeight: 20,
		marginBottom: 16,
		fontWeight: "400",
	},
	actionButtons: {
		width: "100%",
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
