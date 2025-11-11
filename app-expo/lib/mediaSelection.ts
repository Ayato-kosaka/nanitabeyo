import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { CreateDishMediaDto } from "@shared/api/v1/dto";

const MAX_VIDEO_DURATION_SECONDS = 120; // 2 minutes

export interface MediaData {
	type: CreateDishMediaDto["mediaType"];
	uri: string;
	width?: number;
	height?: number;
	durationSec?: number;
	thumbnailUri?: string;
	mimeType: string;
}

interface MediaSelectionResult {
	success: boolean;
	media?: MediaData;
	error?: "cancelled" | "permission_denied" | "video_too_long" | "thumbnail_failed" | "unknown";
	errorMessage?: string;
}

function isVideoAsset(asset: ImagePicker.ImagePickerAsset): boolean {
	if (asset.type === "video") return true;
	const mt = asset.mimeType?.toLowerCase() ?? "";
	if (mt.startsWith("video/")) return true;
	const ext = asset.fileName?.split(".").pop()?.toLowerCase();
	return ext === "mp4" || ext === "mov" || ext === "m4v";
}

// ミリ秒/秒 混在に耐える正規化
function normalizeToSeconds(raw?: number | null): number | null {
	if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return null;
	// 明らかにミリ秒らしい値 (例: 1,000〜120,000 = 1s〜2m)
	// 秒として該当しうる値においてもミリ秒換算されてしまう。
	if (raw > 1000 && raw < 120 * 1000) {
		return Math.round(raw / 1000);
	}
	return Math.round(raw);
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
export async function selectMedia(
	mediaTypes: ImagePicker.MediaType[],
	options?: {
		shouldGenerateThumbnail?: boolean;
		allowsEditing?: boolean;
		aspect?: [number, number];
	},
): Promise<MediaSelectionResult> {
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
			mediaTypes,
			allowsMultipleSelection: false,
			quality: 1,
			videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
			allowsEditing: options?.allowsEditing,
			aspect: options?.aspect,
		});

		if (result.canceled) {
			return { success: false, error: "cancelled" };
		}

		const asset = result.assets[0];
		if (!asset) {
			return { success: false, error: "unknown" };
		}

		const isVideo = isVideoAsset(asset);

		// Check video duration
		let durationSec: number | null = null;
		if (isVideo) {
			// iOS: ms のことが多い。Web は別関数で取得。Android は秒のことが多い。
			durationSec = normalizeToSeconds(asset.duration);
			// For web, we need to get duration manually
			if (Platform.OS === "web" && !durationSec) {
				durationSec = normalizeToSeconds(await getVideoDuration(asset.uri));
			}
			if (durationSec && durationSec > MAX_VIDEO_DURATION_SECONDS) {
				return { success: false, error: "video_too_long" };
			}
		}

		// ---- サムネ生成 ----
		let thumbnailUri: string | undefined;
		if (options?.shouldGenerateThumbnail && isVideo) {
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
			type: isVideo ? "video" : "image",
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
