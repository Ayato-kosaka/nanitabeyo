import React, { useState } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";

export interface VideoPlayerProps {
	uri: string;
	style?: any;
	shouldPlay?: boolean;
	isLooping?: boolean;
	resizeMode?: ResizeMode;
}

/**
 * VideoPlayer component for HLS video playback
 *
 * Supports:
 * - iOS/Android: Uses expo-av Video component with automatic cookie handling
 *
 * The CDN signed cookies are automatically sent by the platform:
 * - iOS/Android: expo-av automatically includes cookies in HLS requests
 */
function VideoPlayer({
	uri,
	style,
	shouldPlay = false,
	isLooping = true,
	resizeMode = ResizeMode.COVER,
}: VideoPlayerProps) {
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
		if (status.isLoaded) {
			setIsLoading(false);
			setError(null);
		} else if ("error" in status && status.error) {
			setIsLoading(false);
			setError(status.error);
		}
	};

	// For iOS/Android, use expo-av Video
	return (
		<View style={[styles.container, style]}>
			{isLoading && (
				<View style={styles.loadingOverlay}>
					<ActivityIndicator size="large" color="#fff" />
				</View>
			)}
			<Video
				source={{ uri }}
				style={StyleSheet.absoluteFill}
				useNativeControls
				resizeMode={resizeMode}
				shouldPlay={shouldPlay}
				isLooping={isLooping}
				onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
			/>
		</View>
	);
}
export default VideoPlayer;

const styles = StyleSheet.create({
	container: {
		position: "relative",
		backgroundColor: "#000",
	},
	loadingOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.5)",
		zIndex: 1,
	},
});
