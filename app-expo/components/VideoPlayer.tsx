import React, { useState } from "react";
import { View, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";

interface VideoPlayerProps {
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
 * - Web: Uses native video element for Safari, hls.js for other browsers (if needed)
 * 
 * The CDN signed cookies are automatically sent by the platform:
 * - iOS/Android: expo-av automatically includes cookies in HLS requests
 * - Web: Browser automatically includes cookies for same-origin requests
 */
export function VideoPlayer({
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

	if (Platform.OS === "web") {
		// For web, use native video element
		// Safari supports HLS natively, other browsers may need hls.js (future enhancement)
		return (
			<View style={[styles.container, style]}>
				{isLoading && (
					<View style={styles.loadingOverlay}>
						<ActivityIndicator size="large" color="#fff" />
					</View>
				)}
				<video
					src={uri}
					controls
					autoPlay={shouldPlay}
					loop={isLooping}
					style={{
						width: "100%",
						height: "100%",
						objectFit: resizeMode === ResizeMode.COVER ? "cover" : "contain",
					}}
					onLoadStart={() => setIsLoading(true)}
					onCanPlay={() => setIsLoading(false)}
					onError={(e) => {
						setIsLoading(false);
						setError("Video playback error");
					}}
				/>
			</View>
		);
	}

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
