import React, { useState, useCallback } from "react";
import { View, StyleSheet, TouchableOpacity, Platform, Modal } from "react-native";
import { Image } from "expo-image";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";
import { Play } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { MediaType } from "@shared/api/v1/dto";

export interface MediaData {
	type: MediaType;
	uri: string;
	width?: number;
	height?: number;
	durationSec?: number;
	thumbnailUri?: string;
	mimeType: string;
}

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

	const handlePlayPress = useCallback(() => {
		setIsVideoModalVisible(true);
	}, []);

	const handleCloseModal = useCallback(() => {
		setIsVideoModalVisible(false);
		setIsMuted(true);
	}, []);

	const handleToggleMute = useCallback(() => {
		setIsMuted((prev) => !prev);
	}, []);

	const displayUri = media.type === "VIDEO" ? media.thumbnailUri || media.uri : media.uri;

	return (
		<>
			<View style={styles.container}>
				<View style={styles.mediaWrapper}>
					<Image
						source={{ uri: displayUri }}
						style={styles.media}
						contentFit="cover"
						accessibilityLabel={
							media.type === "VIDEO" ? i18n.t("Map.media.selectedVideoThumbnail") : i18n.t("Map.media.selectedImage")
						}
					/>
					{media.type === "VIDEO" && (
						<TouchableOpacity
							style={styles.playButton}
							onPress={handlePlayPress}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Map.media.playVideo")}>
							<View style={styles.playIconBackground}>
								<Play size={40} color="#FFF" fill="#FFF" />
							</View>
						</TouchableOpacity>
					)}
				</View>
			</View>

			{/* Video Preview Modal */}
			{media.type === "VIDEO" && (
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
									<Video
										source={{ uri: media.uri }}
										style={styles.videoPlayer}
										useNativeControls
										resizeMode={ResizeMode.CONTAIN}
										isMuted={isMuted}
										shouldPlay
									/>
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
		marginBottom: 16,
	},
	mediaWrapper: {
		height: 320,
		width: 180,
		alignSelf: "center",
		overflow: "hidden",
		position: "relative",
	},
	media: {
		width: "100%",
		height: "100%",
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
		backgroundColor: "#000",
	},
	videoPlayer: {
		width: "100%",
		aspectRatio: 9 / 16,
	},
});
