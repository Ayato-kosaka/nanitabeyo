import React, { useEffect, useState, useRef } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { Video, ResizeMode, AVPlaybackStatus, Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";
import { useLogger } from "@/hooks/useLogger";

export interface VideoPlayerProps {
	uri: string;
	style?: any;
	shouldPlay?: boolean;
	isLooping?: boolean;
	resizeMode?: ResizeMode;
	/** Whether this video is currently active (visible and should be playing) */
	isActive?: boolean;
}

/**
 * VideoPlayer component for HLS video playback
 *
 * Supports:
 * - iOS/Android: Uses expo-av Video component with automatic cookie handling
 *
 * The CDN signed cookies are automatically sent by the platform:
 * - iOS/Android: expo-av automatically includes cookies in HLS requests
 *
 * When isActive is provided:
 * - true: Seeks to position 0 and starts playback
 * - false: Pauses and seeks to position 0
 * - On unmount: Always pauses and unloads video
 */
function VideoPlayer({
	uri,
	style,
	shouldPlay = false,
	isLooping = true,
	resizeMode = ResizeMode.COVER,
	isActive,
}: VideoPlayerProps) {
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const { logFrontendEvent } = useLogger();
	const videoRef = useRef<Video>(null);

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

	// Handle isActive prop changes to control playback
	useEffect(() => {
		if (isActive === undefined) return;

		const controlPlayback = async () => {
			if (!videoRef.current) return;

			try {
				if (isActive) {
					// When becoming active: seek to 0 and play
					await videoRef.current.setPositionAsync(0);
					await videoRef.current.playAsync();

					logFrontendEvent({
						event_name: "video_activated",
						error_level: "log",
						payload: { uri },
					});
				} else {
					// When becoming inactive: pause and seek to 0
					await videoRef.current.pauseAsync();
					await videoRef.current.setPositionAsync(0);

					logFrontendEvent({
						event_name: "video_deactivated",
						error_level: "log",
						payload: { uri },
					});
				}
			} catch (e) {
				logFrontendEvent({
					event_name: "video_playback_control_error",
					error_level: "error",
					payload: {
						error: e instanceof Error ? e.message : String(e),
						uri,
						isActive,
					},
				});
			}
		};

		controlPlayback();
	}, [isActive, uri, logFrontendEvent]);

	// Cleanup on unmount: pause and unload
	useEffect(() => {
		return () => {
			if (videoRef.current) {
				videoRef.current.pauseAsync().catch(() => {});
				videoRef.current.unloadAsync().catch(() => {});
			}
		};
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
				ref={videoRef}
				source={{ uri }}
				style={StyleSheet.absoluteFill}
				useNativeControls
				resizeMode={resizeMode}
				shouldPlay={isActive !== undefined ? isActive : shouldPlay}
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
