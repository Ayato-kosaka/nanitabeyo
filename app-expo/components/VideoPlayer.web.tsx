import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { VideoPlayerProps } from "./VideoPlayer";
import Hls from "hls.js";
import { LoadingIndicator } from "./LoadingIndicator";
import { FixedColors } from "@/constants/Palette";

// Thresholds for loop detection logic:
// LOOP_HEAD_S: If the current playback time is within 1 second of the start (head) of the video,
// it is considered "near the head" for the purposes of detecting a loop.
// LOOP_TAIL_S: If the current playback time is within 0.7 seconds of the end (tail) of the video,
// it is considered "near the tail" for loop detection.
//
// These specific values (1s for head, 0.7s for tail) were chosen based on empirical testing to balance
// responsiveness and robustness. A 1-second window at the head helps reliably detect when the video
// has looped back to the start, even if there are minor timing inaccuracies or buffering delays.
// The 0.7-second window at the tail ensures that the loop is triggered just before the video ends,
// preventing visible stutter or a brief pause at the end, which can occur if the threshold is too small.
// These thresholds help handle edge cases such as:
// - Slightly inaccurate time updates from the video element
// - Network or decoding delays causing the playback position to skip over the exact start/end
// - Ensuring smooth, seamless looping without visible glitches
const LOOP_HEAD_S = 1; // Near the start of the video
const LOOP_TAIL_S = 0.7; // Near the end of the video

/**
 * VideoPlayer component for HLS video playback
 *
 * Supports:
 * - Web: Uses native video element for Safari, hls.js for other browsers (if needed)
 *
 * The CDN signed cookies are automatically sent by the platform:
 * - Web: Browser automatically includes cookies for same-origin requests
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
	const [isNativeHls, setIsNativeHls] = useState<boolean | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);

	const hlsRef = useRef<Hls | null>(null);

	// 進捗/ループ検出用
	const rafId = useRef<number | null>(null);
	const lastTimeRef = useRef(0);

	// playableDuration（バッファ先端 - 現時刻）
	const getPlayableDuration = useCallback((video: HTMLVideoElement) => {
		try {
			const { buffered, currentTime } = video;
			if (!buffered || buffered.length === 0) return 0;
			// 現在位置を含むレンジ、なければ最後のレンジ終端
			for (let i = 0; i < buffered.length; i++) {
				const start = buffered.start(i);
				const end = buffered.end(i);
				if (currentTime >= start && currentTime <= end) {
					return Math.max(0, end - currentTime);
				}
			}
			return Math.max(0, buffered.end(buffered.length - 1) - currentTime);
		} catch {
			return 0;
		}
	}, []);

	// rAF での進捗ポーリング（再生中のみ回す）
	const startProgressLoop = useCallback(() => {
		if (rafId.current != null) return; // 既に稼働中
		const tick = () => {
			const v = videoRef.current;
			if (v) {
				const dur = v.duration;
				const cur = v.currentTime ?? 0;

				// ループ検出（VOD のみ／duration が有限）
				if (
					isLooping &&
					onLoop &&
					Number.isFinite(dur) &&
					dur > 0 &&
					lastTimeRef.current > Math.max(0, dur - LOOP_TAIL_S) && // 直前が終端近辺
					cur < LOOP_HEAD_S // 先頭近辺に戻った
				) {
					onLoop();
				}
				lastTimeRef.current = cur;

				// 進捗通知
				if (onProgress) {
					onProgress({
						currentTime: cur,
						duration: dur,
						playableDuration: getPlayableDuration(v),
					});
				}
			}
			rafId.current = requestAnimationFrame(tick);
		};
		rafId.current = requestAnimationFrame(tick);
	}, [getPlayableDuration, isLooping, onLoop, onProgress]);

	const stopProgressLoop = useCallback(() => {
		if (rafId.current != null) {
			cancelAnimationFrame(rafId.current);
			rafId.current = null;
		}
	}, []);

	// 初期化（HLS 判定 & hls.js セットアップ）
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		// 先に停止/破棄
		stopProgressLoop();
		hlsRef.current?.destroy();
		hlsRef.current = null;
		setIsLoading(true);
		setError(null);
		lastTimeRef.current = 0;

		const canPlayNatively = video.canPlayType("application/vnd.apple.mpegurl") !== "";
		setIsNativeHls(canPlayNatively);

		if (canPlayNatively) {
			// ネイティブ HLS
			video.src = uri;
		} else if (Hls.isSupported()) {
			const hls = new Hls({
				xhrSetup: (xhr) => {
					xhr.withCredentials = true;
				},
			});
			hlsRef.current = hls;
			hls.attachMedia(video);
			hls.loadSource(uri);

			const onErr = (_: string, data: any) => {
				if (data?.fatal) setError(data?.details || "HLS fatal error");
			};
			hls.on(Hls.Events.ERROR, onErr);
			return () => {
				hls.off(Hls.Events.ERROR, onErr);
				hls.destroy();
				hlsRef.current = null;
			};
		} else {
			// 非対応ブラウザ（稀）
			setError("HLS is not supported in this browser");
		}
	}, [uri, stopProgressLoop]);

	// shouldPlay 変更に合わせて再生/一時停止
	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;

		if (shouldPlay) {
			const p = v.play();
			// 自動再生ブロック対策
			if (p && typeof p.catch === "function") {
				p.catch(() => {
					/* no-op */
				});
			}
		} else {
			v.pause();
			// ここで0戻しはしない（UXのため）。必要なら親側で制御。
		}
	}, [shouldPlay]);

	// video イベント購読（ローディング/進捗ループの開始終了）
	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;

		const onLoadStart = () => setIsLoading(true);
		const onCanPlay = () => setIsLoading(false);
		const onPlaying = () => {
			setIsLoading(false);
			startProgressLoop();
		};
		const onPause = () => {
			stopProgressLoop();
		};
		const onEnded = () => {
			// ループ属性が false の場合は終了で止まる
			if (!isLooping) stopProgressLoop();
		};
		const onError = () => {
			setIsLoading(false);
			setError("Video playback error");
		};

		v.addEventListener("loadstart", onLoadStart);
		v.addEventListener("canplay", onCanPlay);
		v.addEventListener("playing", onPlaying);
		v.addEventListener("pause", onPause);
		v.addEventListener("ended", onEnded);
		v.addEventListener("error", onError);

		// ページ非表示/表示での省電力対応
		const onVis = () => {
			if (document.hidden) {
				stopProgressLoop();
			} else if (!v.paused) {
				startProgressLoop();
			}
		};
		document.addEventListener("visibilitychange", onVis);

		return () => {
			v.removeEventListener("loadstart", onLoadStart);
			v.removeEventListener("canplay", onCanPlay);
			v.removeEventListener("playing", onPlaying);
			v.removeEventListener("pause", onPause);
			v.removeEventListener("ended", onEnded);
			v.removeEventListener("error", onError);
			document.removeEventListener("visibilitychange", onVis);
			stopProgressLoop();
		};
	}, [isLooping, startProgressLoop, stopProgressLoop]);

	// NOTE: hls.js 使用時は src を指定しない（attachMedia が管理）
	// For web, use native video element
	// Safari supports HLS natively, other browsers may need hls.js (future enhancement)
	return (
		<View style={[styles.container, style]}>
			{isLoading && (
				<View style={styles.loadingOverlay}>
					<LoadingIndicator size="large" />
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

/*
#1629 native 実装（VideoPlayer.tsx）と同じ理由で、地はテーマに追従させない。
動画の余白は常に黒であること自体が仕様（`mediaBackground`）で、
ライトで明るくすると縦動画の左右だけが白い額縁になる。
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
});
