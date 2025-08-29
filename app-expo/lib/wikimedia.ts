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
