import React, { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { Video, ResizeMode, AVPlaybackStatus, Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";
import { useLogger } from "@/hooks/useLogger";

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
	const { logFrontendEvent } = useLogger();

	useEffect(() => {
		(async () => {
			try {
				await Audio.setAudioModeAsync({
					allowsRecordingIOS: false,
					staysActiveInBackground: false,
					playsInSilentModeIOS: true, // iOSサイレントでも再生
					interruptionModeIOS: InterruptionModeIOS.DoNotMix,
					shouldDuckAndroid: true, // Androidで他音源を下げる
					interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
					playThroughEarpieceAndroid: false,
				});
			} catch (e) {
				logFrontendEvent({
					event_name: "audio_mode_error",
					error_level: "error",
					payload: { error: e instanceof Error ? e.message : String(e) },
				});
			}
		})();
	}, []);

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
				isMuted={false}
				volume={1.0}
				onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
				onError={(e) => {
					setIsLoading(false);
					setError(String(e));
				}}
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
