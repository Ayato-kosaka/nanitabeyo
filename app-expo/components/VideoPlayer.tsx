import React, { useEffect, useRef, useState, useMemo } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { VideoView, useVideoPlayer, VideoContentFit, VideoSource } from "expo-video";
import { useLogger } from "@/hooks/useLogger";
import { setAudioModeAsync } from "expo-audio";
import { useCdnCookieStore, selectCookieHeader } from "@/stores/useCdnCookieStore";
import { LoadingIndicator } from "./LoadingIndicator";
import { FixedColors } from "@/constants/Palette";

// Threshold for detecting video loop (when currentTime returns to near start)
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
 * - iOS/Android: Uses expo-video VideoView component with CDN Cookie header injection
 *
 * #501 【設計】ネイティブ（Android / iOS）では expo-video の headers オプションを使用し、
 * CDN サインド Cookie を明示的に付与する。
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
	const { logFrontendEvent } = useLogger();
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState<boolean>(false);
	const lastLoopTime = useRef(0);

	// #501 【設計】動画の再試行用トークンと再試行済みフラグ
	const [retryToken, setRetryToken] = useState(0);
	const hasRetriedWithNewCookie = useRef(false);

	const videoSource: VideoSource = useMemo(() => {
		// #501 【設計】CDN Cookie を取得し、動画リクエストの Cookie ヘッダに設定する
		// VideoPlayer マウント時 / URI 変更時、および retryToken 変更時に再評価されるようにする。
		// retryToken は 403 エラー発生時に最新 Cookie を取得して再試行するために使用する。
		const cdnCookieHeader = selectCookieHeader(useCdnCookieStore.getState());
		if (!cdnCookieHeader) {
			// Cookie がない場合は URI のみ指定
			return uri;
		}
		return {
			uri,
			headers: {
				Cookie: cdnCookieHeader,
			},
		};
	}, [uri, retryToken]);

	const player = useVideoPlayer(videoSource, (player) => {
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
				hasRetriedWithNewCookie.current = false;
			} else if (status.status === "error") {
				const message = status.error?.message;
				if (
					!hasRetriedWithNewCookie.current &&
					message &&
					(message.toLowerCase().includes("403") || message.toLowerCase().includes("forbidden"))
				) {
					// 403 ぽいエラーかつ、まだリトライしていないなら再試行する
					hasRetriedWithNewCookie.current = true;
					// 最新 Cookie を store から取り直すため、retryToken をインクリメント
					setIsLoading(true);
					setError(null);
					setRetryToken((prev) => prev + 1);
				} else {
					setIsLoading(false);
					setError(message || "Video playback error");
				}
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
					<LoadingIndicator size="large" />
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

/*
#1629 ここはテーマで振らない。動画の «外側» に見える余白と、その上に載る操作要素だからである。

- 地は `mediaBackground`（固定の黒）。DishMediaFeed と同じ「メディアを引き立てる黒背景」で、
  ライトで明るくすると縦動画の左右だけが白い額縁になり、動画そのものが読みにくくなる
- 再生アイコンは `onMedia`（固定の白）。載る先が常に暗い動画なので、ライトで黒にすると消える
*/
const styles = StyleSheet.create({
	container: {
		position: "relative",
		backgroundColor: FixedColors.mediaBackground,
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
		color: FixedColors.onMedia,
		opacity: 0.65,
		// A slight text shadow to make the icon readable on variable backgrounds
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
});
