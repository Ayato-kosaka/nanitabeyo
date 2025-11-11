import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import i18n from "@/lib/i18n";
import { Card } from "@/components/Card";
import { MediaData, selectMedia } from "@/lib/mediaSelection";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";

interface AvatarImageCardProps {
	/** 現在のアバター画像URL（なければプレースホルダ） */
	avatarUrl: string | null;
	/** 画像選択ボタン押下時のコールバック */
	onSelectImage: (media: Pick<MediaData, "uri" | "mimeType">) => void;
	/** レイアウト計測用コールバック */
	onLayout?: (event: any) => void;
}

/**
 * プロフィール画像カード
 * - 現在の画像を表示
 * - タップで新しい画像を選択
 */
export function AvatarImageCard({ avatarUrl, onSelectImage, onLayout }: AvatarImageCardProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();

	const [isLoading, setIsLoading] = useState(false);

	const handleSelectImage = useCallback(async () => {
		setIsLoading(true);
		lightImpact();
		try {
			const result = await selectMedia(["images"], {
				allowsEditing: true, // 編集モードを有効化（正方形トリミング）
				aspect: [1, 1], // 正方形のアスペクト比
			});
			if (result.success && result.media) onSelectImage({ uri: result.media.uri, mimeType: result.media.mimeType });
			else if (result.error === "permission_denied") showSnackbar(i18n.t("Profile.errors.permissionDenied"));
			else if (result.error === "cancelled") {
			} // ユーザーキャンセルは無視
			else {
				showSnackbar(i18n.t("Map.media.mediaSelectionFailed"));
				throw new Error("Media selection failed: " + result.errorMessage);
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "avatar_image_selection_failed",
				error_level: "error",
				payload: { error: (error as Error).message },
			});
		} finally {
			setIsLoading(false);
		}
	}, [lightImpact, logFrontendEvent, onSelectImage, showSnackbar]);

	return (
		<Card onLayout={onLayout}>
			<Text style={styles.label}>{i18n.t("Profile.labels.profileImage")}</Text>

			<View style={styles.avatarWrapper}>
				<TouchableOpacity
					style={styles.avatarContainer}
					onPress={handleSelectImage}
					disabled={isLoading}
					activeOpacity={0.8}>
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
			</View>

			<Text style={styles.hint}>{i18n.t("Profile.hints.tapToSelectImage")}</Text>
		</Card>
	);
}

const styles = StyleSheet.create({
	label: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 16,
		alignSelf: "flex-start",
	},
	avatarWrapper: {
		alignItems: "center",
	},
	avatarContainer: {
		width: 120,
		height: 120,
		marginBottom: 8,
		position: "relative",
	},
	avatar: {
		width: "100%",
		height: "100%",
		overflow: "hidden",
		borderRadius: 20,
		borderWidth: 3,
		borderColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
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
