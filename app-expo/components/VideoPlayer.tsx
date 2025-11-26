import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Pressable, Text } from "react-native";
import { VideoView, useVideoPlayer, VideoContentFit } from "expo-video";
import { useLogger } from "@/hooks/useLogger";
import { setAudioModeAsync } from "expo-audio"; // Threshold for detecting video loop (when currentTime returns to near start)
export const LOOP_DETECTION_THRESHOLD_SECONDS = 1;
// Progress tracking interval in milliseconds
const PROGRESS_CHECK_INTERVAL_MS = 250;

export interface VideoPlayerProps {
	uri: string;
	style?: any;
	shouldPlay?: boolean;
	isLooping?: boolean;
	resizeMode?: VideoContentFit;
	onProgress?: (progress: { currentTime: number; duration: number; playableDuration?: number }) => void;
	onLoop?: () => void;
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
function VideoPlayer({
	uri,
	style,
	shouldPlay = false,
	isLooping = true,
	resizeMode = "cover",
	onProgress,
	onLoop,
}: VideoPlayerProps) {
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState<boolean>(false);
	const lastLoopTime = useRef(0);
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
				await setAudioModeAsync({
					// iOS
					allowsRecording: false,
					playsInSilentMode: true,
					interruptionMode: "doNotMix",
					// 共通
					shouldPlayInBackground: false,
					// Android
					interruptionModeAndroid: "doNotMix",
					shouldRouteThroughEarpiece: false,
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

	// Sync with external shouldPlay prop.
	useEffect(() => {
		if (shouldPlay) {
			player.play();
		} else {
			player.pause();
			// Reset video position when paused by external prop to ensure fresh start on next external play
			player.currentTime = 0;
		}
	}, [shouldPlay, player]);

	useEffect(() => {
		player.loop = isLooping;
	}, [isLooping, player]);

	useEffect(() => {
		const statusChangeSubscription = player.addListener("statusChange", (status) => {
			if (status.status === "readyToPlay") {
				setIsLoading(false);
				setError(null);
			} else if (status.status === "error") {
				setIsLoading(false);
				setError(status.error?.message || "Video playback error");
			}
		});
		const playingChangeSubscription = player.addListener("playingChange", (payload) => {
			setIsPlaying(payload.isPlaying);
		});

		return () => {
			statusChangeSubscription.remove();
			playingChangeSubscription.remove();
		};
	}, [player]);

	// Progress tracking
	useEffect(() => {
		if (!onProgress && !onLoop) return;

		const interval = setInterval(() => {
			if (player.currentTime !== undefined && player.duration > 0) {
				// Detect loop (when currentTime goes back to near 0)
				if (
					onLoop &&
					lastLoopTime.current > LOOP_DETECTION_THRESHOLD_SECONDS &&
					player.currentTime < LOOP_DETECTION_THRESHOLD_SECONDS
				) {
					onLoop();
				}
				lastLoopTime.current = player.currentTime;

				// Report progress
				if (onProgress) {
					onProgress({
						currentTime: player.currentTime,
						duration: player.duration,
					});
				}
			}
		}, PROGRESS_CHECK_INTERVAL_MS);

		return () => clearInterval(interval);
	}, [player, onProgress, onLoop]);

	// Toggle play/pause on tap
	const handleTogglePlay = () => {
		if (isPlaying) {
			player.pause();
			// Do NOT reset currentTime when user taps pause; keep position for resume
		} else {
			player.play();
		}
	};

	// For iOS/Android, use expo-video VideoView
	return (
		<View style={[styles.container, style]}>
			{isLoading && (
				<View style={styles.loadingOverlay}>
					<ActivityIndicator size="large" color="#fff" />
				</View>
			)}
			{/* Pressable covers the video area and toggles playback on tap */}
			<Pressable style={StyleSheet.absoluteFill} onPress={handleTogglePlay}>
				{/* Video is rendered underneath but Pressable must be transparent */}
				<VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit={resizeMode} />
				{/* When paused, show a faint centered play icon like TikTok */}
				{!isPlaying && !isLoading && !error && (
					<View pointerEvents="none" style={styles.playOverlay}>
						<Text style={styles.playIcon}>▶</Text>
					</View>
				)}
			</Pressable>
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
	playOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
		zIndex: 2,
	},
	playIcon: {
		fontSize: 72,
		color: "#fff",
		opacity: 0.65,
		// A slight text shadow to make the icon readable on variable backgrounds
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
