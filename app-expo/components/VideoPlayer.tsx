import React, { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { VideoView, useVideoPlayer, VideoContentFit } from "expo-video";
import { useLogger } from "@/hooks/useLogger";
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";

export interface VideoPlayerProps {
	uri: string;
	style?: any;
	shouldPlay?: boolean;
	isLooping?: boolean;
	resizeMode?: VideoContentFit;
}

/**
 * VideoPlayer component for HLS video playback
 *
 * Supports:
 * - iOS/Android: Uses expo-video VideoView component with automatic cookie handling
 *
 * The CDN signed cookies are automatically sent by the platform:
 * - iOS/Android: expo-video automatically includes cookies in HLS requests
 */
function VideoPlayer({ uri, style, shouldPlay = false, isLooping = true, resizeMode = "cover" }: VideoPlayerProps) {
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const { logFrontendEvent } = useLogger();

	const player = useVideoPlayer(uri, (player) => {
		player.loop = isLooping;
		player.muted = false;
		player.volume = 1.0;
		if (shouldPlay) {
			player.play();
		}
	});

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

	useEffect(() => {
		if (shouldPlay) {
			player.play();
		} else {
			player.pause();
			// Reset video position when paused to ensure fresh start on next play
			player.currentTime = 0;
		}
	}, [shouldPlay, player]);

	useEffect(() => {
		player.loop = isLooping;
	}, [isLooping, player]);

	useEffect(() => {
		const subscription = player.addListener("statusChange", (status) => {
			if (status.status === "readyToPlay") {
				setIsLoading(false);
				setError(null);
			} else if (status.status === "error") {
				setIsLoading(false);
				setError(status.error?.message || "Video playback error");
			}
		});

		return () => {
			subscription.remove();
		};
	}, [player]);

	// For iOS/Android, use expo-video VideoView
	return (
		<View style={[styles.container, style]}>
			{isLoading && (
				<View style={styles.loadingOverlay}>
					<ActivityIndicator size="large" color="#fff" />
				</View>
			)}
			<VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit={resizeMode} />
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
