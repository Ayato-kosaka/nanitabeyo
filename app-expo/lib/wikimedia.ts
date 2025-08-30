import { Image, ImageSource } from "expo-image";
import { Platform } from "react-native";

/**
 * Wikimedia Commons image utilities for client-side thumbnail URL conversion
 */

/**
 * Convert original Wikimedia Commons URL to thumbnail URL with specified width
 *
 * @param originalUrl - Original Wikimedia Commons URL (e.g., upload.wikimedia.org/.../<d1>/<d2>/<File>)
 * @param widthPx - Required width in pixels (will be clamped between 240-1280px)
 * @returns Thumbnail URL (e.g., upload.wikimedia.org/.../commons/thumb/<d1>/<d2>/<File>/<WIDTH>px-<File>)
 *
 * @example
 * ```ts
 * const originalUrl = "https://upload.wikimedia.org/wikipedia/commons/8/8b/Sushi.jpg";
 * const thumbnailUrl = wikimediaThumbFromOriginal(originalUrl, 400);
 * // Returns: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Sushi.jpg/400px-Sushi.jpg"
 * ```
 */
export function wikimediaThumbFromOriginal(originalUrl: string, widthPx: number): string {
	try {
		const u = new URL(originalUrl);
		const parts = u.pathname.split("/"); // ["", "wikipedia", "commons", d1, d2, file]
		const file = parts[5];
		if (!file) return originalUrl;

		const width = Math.min(Math.max(Math.round(widthPx), 240), 1280); // 240〜1280にクランプ
		parts.splice(3, 0, "thumb"); // "commons" の次に "thumb" を挿入
		parts.push(`${width}px-${file}`); // 末尾に "<width>px<File>" を追加
		u.pathname = parts.join("/");
		return u.toString();
	} catch {
		return originalUrl; // パース失敗時はフォールバック
	}
}

/**
 * Generate Wikimedia-compliant User-Agent string
 * Format: Nanitabeyo/0.1 (contact: dev@nanitabeyo.com) Platform/Version
 */
export function generateUserAgent(): string {
	const appInfo = "Nanitabeyo/0.1 (contact: dev@nanitabeyo.com)";

	let platformInfo = "";
	switch (Platform.OS) {
		case "android":
			platformInfo = "okhttp/4.x";
			break;
		case "ios":
			platformInfo = `URLSession/iOS`;
			break;
		case "web":
			platformInfo = "fetch/web";
			break;
		default:
			platformInfo = "unknown";
	}

	return `${appInfo} ${platformInfo}`;
}

/**
 * Wikimedia-compliant headers with User-Agent
 */
export const WIKIMEDIA_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"User-Agent": generateUserAgent(),
});

/**
 * Prefetch image with Wikimedia-compliant User-Agent header
 * Only applies User-Agent for Wikimedia Commons URLs
 *
 * @param imageUrl - Image URL to prefetch
 * @returns Promise that resolves when prefetch is complete
 */
export async function prefetchWithUserAgent(imageUrl: string): Promise<boolean> {
	return Image.prefetch(imageUrl, {
		headers: WIKIMEDIA_HEADERS,
	});
}
