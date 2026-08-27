import React, { useState, useCallback, useEffect } from "react";
import { View, StyleSheet, TouchableOpacity, Platform, Modal } from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { Play } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { MediaData } from "../../../lib/mediaSelection";
import { getCacheKeyForImage } from "@/lib/image";
import { FixedColors } from "@/constants/Palette";

interface InitialMediaPreviewProps {
	media: MediaData;
}

/**
 * InitialMediaPreview component displays media with 9:16 aspect ratio.
 * - For images: displays the image directly
 * - For videos: displays thumbnail with play icon overlay, opens video preview on tap
 */
export function InitialMediaPreview({ media }: InitialMediaPreviewProps) {
	const [isVideoModalVisible, setIsVideoModalVisible] = useState(false);
	const [isMuted, setIsMuted] = useState(true);

	// Only create player for video media
	const isVideo = media.type === "video";
	const player = useVideoPlayer(isVideo ? media.uri : "", (player) => {
		if (!isVideo) return;
		player.loop = false;
		player.muted = true;
	});

	// Update player mute state when isMuted changes
	useEffect(() => {
		if (isVideo && player) {
			player.muted = isMuted;
		}
	}, [isMuted, player, isVideo]);

	const handlePlayPress = useCallback(() => {
		if (!isVideo) return;
		setIsVideoModalVisible(true);
		player.play();
	}, [player, isVideo]);

	const handleCloseModal = useCallback(() => {
		setIsVideoModalVisible(false);
		if (isVideo && player) {
			player.pause();
		}
		setIsMuted(true);
	}, [player, isVideo]);

	const handleToggleMute = useCallback(() => {
		if (!isVideo || !player) return;
		setIsMuted((prev) => {
			const newMuted = !prev;
			player.muted = newMuted;
			return newMuted;
		});
	}, [player, isVideo]);

	const displayUri = media.type === "video" ? media.thumbnailUri || media.uri : media.uri;

	return (
		<>
			<View style={styles.container}>
				<View style={styles.mediaWrapper}>
					<Image
						source={{ uri: displayUri, cacheKey: getCacheKeyForImage(displayUri) }}
						style={styles.media}
						contentFit="cover"
						accessibilityLabel={
							media.type === "video" ? i18n.t("Map.media.selectedVideoThumbnail") : i18n.t("Map.media.selectedImage")
						}
					/>
					{media.type === "video" && (
						<TouchableOpacity
							style={styles.playButton}
							onPress={handlePlayPress}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Map.media.playVideo")}>
							<View style={styles.playIconBackground}>
								{/*
								#1629 再生アイコンは «選んだ写真・動画そのもの» の上に重なる。
								メディアの上は常に暗いので、ライトで黒くすると見えなくなる（onMedia の定義そのもの）。
								*/}
								<Play size={40} color={FixedColors.onMedia} fill={FixedColors.onMedia} />
							</View>
						</TouchableOpacity>
					)}
				</View>
			</View>

			{/* Video Preview Modal */}
			{media.type === "video" && (
				<Modal visible={isVideoModalVisible} animationType="fade" transparent={true} onRequestClose={handleCloseModal}>
					<View style={styles.modalContainer}>
						<TouchableOpacity style={styles.modalBackdrop} onPress={handleCloseModal} activeOpacity={1} />
						<View style={styles.videoContainer}>
							{Platform.OS === "web" ? (
								<video
									src={media.uri}
									controls
									muted={isMuted}
									playsInline
									style={{
										width: "100%",
										maxHeight: "80vh",
										aspectRatio: 9 / 16,
										objectFit: "contain",
									}}
									onClick={handleToggleMute}
								/>
							) : (
								<TouchableOpacity onPress={handleToggleMute} activeOpacity={1}>
									<VideoView player={player} style={styles.videoPlayer} nativeControls contentFit="contain" />
								</TouchableOpacity>
							)}
						</View>
					</View>
				</Modal>
			)}
		</>
	);
}

const styles = StyleSheet.create({
	container: {
		width: "100%",
		height: "100%",
		marginBottom: 16,
	},
	mediaWrapper: {
		height: "100%",
		aspectRatio: 9 / 16,
		alignSelf: "center",
		overflow: "hidden",
		position: "relative",
	},
	media: {
		...StyleSheet.absoluteFillObject,
	},
	playButton: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
	},
	playIconBackground: {
		width: 80,
		height: 80,
		borderRadius: 40,
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		justifyContent: "center",
		alignItems: "center",
	},
	modalContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	modalBackdrop: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "rgba(0, 0, 0, 0.9)",
	},
	videoContainer: {
		width: "90%",
		maxWidth: 500,
		aspectRatio: 9 / 16,
		borderRadius: 12,
		overflow: "hidden",
		// #1629 動画の余白（9:16 に収まらない部分）。メディアビューアと同じで常に黒であること自体が仕様
		backgroundColor: FixedColors.mediaBackground,
	},
	videoPlayer: {
		width: "100%",
		aspectRatio: 9 / 16,
	},
});
