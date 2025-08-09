import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Lock } from "lucide-react-native";
import { ImageCardGrid } from "@/components/ImageCardGrid";
import Stars from "@/components/Stars";
import { UserPost } from "@/types";
import { WalletTabs } from "./WalletTabs";
import i18n from "@/lib/i18n";

type TabType = "posts" | "saved" | "liked" | "wallet";

interface PostsContentProps {
	selectedTab: TabType;
	posts: UserPost[];
	isOwnProfile: boolean;
}

/**
 * PostsContent コンポーネント
 * プロフィール画面のコンテンツ表示部分（投稿グリッド、ウォレット、プライベートコンテンツ）を表示する
 */
export function PostsContent({ selectedTab, posts, isOwnProfile }: PostsContentProps) {
	if (selectedTab === "wallet") {
		return <WalletTabs />;
	}

	if (selectedTab === "saved" && !isOwnProfile) {
		return (
			<View style={styles.privateContainer}>
				<View style={styles.privateCard}>
					<Lock size={48} color="#6B7280" />
					<Text style={styles.privateText}>{i18n.t("Profile.privateContent")}</Text>
				</View>
			</View>
		);
	}

	return (
		<ImageCardGrid
			data={posts}
			containerStyle={{ marginVertical: 16 }}
			renderOverlay={(item) => (
				<View style={styles.reviewCardOverlay}>
					<Text style={styles.reviewCardTitle}>{item.dishName}</Text>
					<View style={styles.reviewCardRating}>
						<Stars rating={item.likes / 10000} />
						<Text style={styles.reviewCardRatingText}>({item.reviewCount})</Text>
					</View>
				</View>
			)}
		/>
	);
}

const styles = StyleSheet.create({
	privateContainer: {
		flex: 1,
		paddingHorizontal: 16,
	},
	privateCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		justifyContent: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	privateText: {
		fontSize: 17,
		color: "#6B7280",
		marginTop: 16,
		fontWeight: "500",
		textAlign: "center",
	},
	reviewCardOverlay: {
		position: "absolute",
		bottom: 8,
		left: 8,
		right: 8,
		flexDirection: "column",
		justifyContent: "space-between",
	},
	reviewCardTitle: {
		fontSize: 12,
		fontWeight: "600",
		color: "#FFF",
		marginBottom: 4,
	},
	reviewCardRating: {
		flexDirection: "row",
		alignItems: "center",
	},
	reviewCardRatingText: {
		fontSize: 10,
		color: "#FFF",
		marginLeft: 4,
	},
});
