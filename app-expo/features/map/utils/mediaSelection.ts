import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import type { MediaData } from "../components/InitialMediaPreview";

const MAX_VIDEO_DURATION_SECONDS = 120; // 2 minutes

interface MediaSelectionResult {
	success: boolean;
	media?: MediaData;
	error?: "cancelled" | "permission_denied" | "video_too_long" | "thumbnail_failed" | "unknown";
	errorMessage?: string;
}

/**
 * Request media library permissions
 */
async function requestPermissions(): Promise<boolean> {
	if (Platform.OS === "web") {
		return true; // Web doesn't need permission
	}

	const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
	return status === "granted";
}

/**
 * Generate thumbnail for video
 * Uses 0.1s to avoid black frames at the start
 */
async function generateVideoThumbnail(uri: string): Promise<string | null> {
	try {
		if (Platform.OS === "web") {
			// For web, create a thumbnail using video element and canvas
			return new Promise((resolve) => {
				const video = document.createElement("video");
				video.src = uri;
				video.currentTime = 0.1; // Seek to 0.1s to avoid black frame
				video.muted = true;
				video.playsInline = true;

				video.addEventListener("loadeddata", () => {
					try {
						const canvas = document.createElement("canvas");
						canvas.width = video.videoWidth;
						canvas.height = video.videoHeight;
						const ctx = canvas.getContext("2d");
						if (ctx) {
							ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
							const dataURL = canvas.toDataURL("image/jpeg", 0.8);
							resolve(dataURL);
						} else {
							resolve(null);
						}
					} catch (error) {
						console.error("Error generating web thumbnail:", error);
						resolve(null);
					} finally {
						video.remove();
					}
				});

				video.addEventListener("error", () => {
					video.remove();
					resolve(null);
				});

				video.load();
			});
		} else {
			// For native platforms, use expo-video-thumbnails
			const { uri: thumbnailUri } = await VideoThumbnails.getThumbnailAsync(uri, {
				time: 100, // 100ms to avoid black frame
			});
			return thumbnailUri;
		}
	} catch (error) {
		console.error("Error generating thumbnail:", error);
		return null;
	}
}

/**
 * Get video duration in seconds
 */
async function getVideoDuration(uri: string): Promise<number | null> {
	try {
		if (Platform.OS === "web") {
			return new Promise((resolve) => {
				const video = document.createElement("video");
				video.src = uri;
				video.muted = true;
				video.playsInline = true;

				video.addEventListener("loadedmetadata", () => {
					const duration = video.duration;
					video.remove();
					resolve(duration);
				});

				video.addEventListener("error", () => {
					video.remove();
					resolve(null);
				});

				video.load();
			});
		}
		// For native, duration is already in the picker result
		return null;
	} catch (error) {
		console.error("Error getting video duration:", error);
		return null;
	}
}

/**
 * Launch media picker and handle media selection
 * Returns media data with thumbnail for videos
 */
export async function selectMediaForReview(): Promise<MediaSelectionResult> {
	try {
		// Request permissions
		const hasPermission = await requestPermissions();
		if (!hasPermission) {
			return {
				success: false,
				error: "permission_denied",
			};
		}

		// Launch picker
		const result = await ImagePicker.launchImageLibraryAsync({
			mediaTypes: ["images", "videos"], // Allow both images and videos
			allowsMultipleSelection: false,
			quality: 1,
			videoMaxDuration: MAX_VIDEO_DURATION_SECONDS, // Hint for picker, but we validate anyway
		});

		if (result.canceled) {
			return {
				success: false,
				error: "cancelled",
			};
		}

		const asset = result.assets[0];
		if (!asset) {
			return {
				success: false,
				error: "unknown",
			};
		}

		const isVideo = asset.type === "video";

		// Check video duration
		let durationSec = asset.duration;
		if (isVideo) {
			// For web, we need to get duration manually
			if (Platform.OS === "web" && !durationSec) {
				durationSec = await getVideoDuration(asset.uri);
			}

			if (durationSec && durationSec > MAX_VIDEO_DURATION_SECONDS) {
				return {
					success: false,
					error: "video_too_long",
				};
			}
		}

		// Generate thumbnail for video
		let thumbnailUri: string | undefined;
		if (isVideo) {
			const thumbnail = await generateVideoThumbnail(asset.uri);
			if (!thumbnail) {
				return {
					success: false,
					error: "thumbnail_failed",
				};
			}
			thumbnailUri = thumbnail;
		}

		const media: MediaData = {
			type: isVideo ? "VIDEO" : "IMAGE",
			uri: asset.uri,
			width: asset.width,
			height: asset.height,
			durationSec: isVideo && durationSec ? durationSec : undefined,
			thumbnailUri: isVideo ? thumbnailUri : undefined,
			mimeType: asset.mimeType ?? "application/octet-stream",
		};

		return {
			success: true,
			media,
		};
	} catch (error) {
		console.error("Error selecting media:", error);
		return {
			success: false,
			error: "unknown",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}
