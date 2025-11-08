import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Image as RNImage, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import i18n from "@/lib/i18n";

interface AvatarImageCardProps {
	/** 現在のアバター画像URL（なければプレースホルダ） */
	avatarUrl?: string;
	/** 画像選択中かどうか */
	isLoading?: boolean;
	/** 画像選択ボタン押下時のコールバック */
	onSelectImage: () => void;
	/** レイアウト計測用コールバック */
	onLayout?: (event: any) => void;
}

/**
 * プロフィール画像カード
 * - 現在の画像を表示
 * - タップで新しい画像を選択
 */
export function AvatarImageCard({ avatarUrl, isLoading, onSelectImage, onLayout }: AvatarImageCardProps) {
	return (
		<View style={styles.container} onLayout={onLayout}>
			<Text style={styles.label}>{i18n.t("Profile.labels.profileImage")}</Text>

			<TouchableOpacity style={styles.avatarContainer} onPress={onSelectImage} disabled={isLoading} activeOpacity={0.8}>
				{isLoading ? (
					<View style={styles.avatarPlaceholder}>
						<ActivityIndicator size="large" color="#007AFF" />
					</View>
				) : avatarUrl ? (
					<Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
				) : (
					<View style={styles.avatarPlaceholder}>
						<Ionicons name="person-circle-outline" size={64} color="#999" />
					</View>
				)}

				{/* カメラアイコンオーバーレイ */}
				<View style={styles.cameraIconContainer}>
					<Ionicons name="camera" size={20} color="#FFFFFF" />
				</View>
			</TouchableOpacity>

			<Text style={styles.hint}>{i18n.t("Profile.hints.tapToSelectImage")}</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		backgroundColor: "#FFFFFF",
		borderRadius: 12,
		padding: 16,
		marginBottom: 12,
		alignItems: "center",
	},
	label: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 16,
		alignSelf: "flex-start",
	},
	avatarContainer: {
		width: 120,
		height: 120,
		borderRadius: 60,
		overflow: "hidden",
		borderWidth: 3,
		borderColor: "#E5E7EB",
		marginBottom: 8,
		position: "relative",
	},
	avatar: {
		width: "100%",
		height: "100%",
	},
	avatarPlaceholder: {
		width: "100%",
		height: "100%",
		backgroundColor: "#F3F4F6",
		justifyContent: "center",
		alignItems: "center",
	},
	cameraIconContainer: {
		position: "absolute",
		bottom: 0,
		right: 0,
		width: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: "#007AFF",
		justifyContent: "center",
		alignItems: "center",
		borderWidth: 2,
		borderColor: "#FFFFFF",
	},
	hint: {
		fontSize: 12,
		color: "#6B7280",
		textAlign: "center",
	},
});
