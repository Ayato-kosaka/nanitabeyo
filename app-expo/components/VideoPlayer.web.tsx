import React, { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { VideoPlayerProps } from "./VideoPlayer";
import Hls from "hls.js";

type VideoContentFit = "contain" | "cover" | "fill";

/**
 * VideoPlayer component for HLS video playback
 *
 * Supports:
 * - Web: Uses native video element for Safari, hls.js for other browsers (if needed)
 *
 * The CDN signed cookies are automatically sent by the platform:
 * - Web: Browser automatically includes cookies for same-origin requests
 */
function VideoPlayer({ uri, style, shouldPlay = false, isLooping = true, resizeMode = "cover" }: VideoPlayerProps) {
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		// Safari (ネイティブ HLS) は hls.js 不要
		const canPlayNatively = video.canPlayType("application/vnd.apple.mpegurl") !== "";
		if (canPlayNatively) {
			video.src = uri; // ネイティブ再生
			return;
		}

		if (Hls.isSupported()) {
			const hls = new Hls({
				// 重要：全リクエストで Cookie を送る
				xhrSetup: (xhr: XMLHttpRequest, url: string) => {
					xhr.withCredentials = true;
				},
			});
			hls.loadSource(uri);
			hls.attachMedia(video);
			const onErr = (event: string, data: any) => {
				if (data?.fatal) {
					setError(data?.details || "HLS fatal error");
				}
			};
			hls.on(Hls.Events.ERROR, onErr);
			return () => {
				hls.off(Hls.Events.ERROR, onErr);
				hls.destroy();
			};
		} else {
			// 非対応ブラウザ（稀）
			setError("HLS is not supported in this browser");
		}
	}, [uri]);

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
				// Cookie を送るために必須
				src={uri}
				crossOrigin="use-credentials"
				ref={videoRef}
				controls
				autoPlay={shouldPlay}
				loop={isLooping}
				style={{
					width: "100%",
					height: "100%",
					objectFit: resizeMode === "cover" ? "cover" : "contain",
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
