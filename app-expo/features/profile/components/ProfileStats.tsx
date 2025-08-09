import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { UserProfile } from "@/types";
import i18n from "@/lib/i18n";

interface ProfileStatsProps {
	profile: UserProfile;
	formatNumber: (num: number) => string;
}

/**
 * ProfileStats コンポーネント
 * プロフィール画面のアバターとフォロワー・フォロー・いいね数の統計を表示する
 */
export function ProfileStats({ profile, formatNumber }: ProfileStatsProps) {
	return (
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
});
