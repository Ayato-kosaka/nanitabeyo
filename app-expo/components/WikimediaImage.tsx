import React from "react";
import { View, StyleSheet, PixelRatio, Platform } from "react-native";
import { Image, ImageSource } from "expo-image";

/**
 * Generate User-Agent header according to Wikimedia policy
 * Format: Nanitabeyo/0.1 (contact: email) Platform/Version expo-image/Version
 */
export const getUserAgent = (): string => {
	const appName = "Nanitabeyo";
	const appVersion = "0.1";
	const contact = "contact: dev@nanitabeyo.com";
	
	// Platform-specific user agent components
	const platformInfo = Platform.select({
		android: "okhttp/4.x",
		ios: "URLSession/iOS",
		web: "fetch/web",
		default: "expo/client",
	});
	
	const expoImageVersion = "expo-image/2.x";
	
	return `${appName}/${appVersion} (${contact}) ${platformInfo} ${expoImageVersion}`;
};

/**
 * Prefetch image with proper User-Agent header for Wikimedia compliance
 */
export const prefetchWithUserAgent = async (uri: string): Promise<boolean> => {
	return Image.prefetch(uri, {
		headers: {
			"User-Agent": getUserAgent(),
		},
	});
};

interface WikimediaImageProps {
	/** Original Wikimedia Commons URL (e.g., upload.wikimedia.org/.../File.jpg) */
	uri: string;
	/** Display width in logical pixels */
	width: number;
	/** Display height in logical pixels */
	height: number;
	/** Content fit mode for the image */
	contentFit?: "cover" | "contain" | "fill" | "scale-down" | "none";
	/** Border radius for the image */
	borderRadius?: number;
	/** Custom style for the container */
	style?: any;
	/** Placeholder image while loading */
	placeholder?: ImageSource;
	/** Recycling key for FlatList performance */
	recyclingKey?: string;
	/** Additional props to pass to expo-image */
	imageProps?: any;
}

/**
 * WikimediaImage component for displaying Wikimedia Commons images with optimized performance
 *
 * Features:
 * - Automatic thumbnail URL conversion for bandwidth optimization
 * - User-Agent header to prevent 403 errors on Android
 * - Device pixel ratio consideration for optimal quality
 * - Standardized caching and transition settings
 * - Graceful fallback for non-Wikimedia URLs
 */
export function WikimediaImage({
	uri,
	width,
	height,
	contentFit = "cover",
	borderRadius = 0,
	style,
	placeholder,
	recyclingKey,
	imageProps = {},
}: WikimediaImageProps) {
	/**
	 * Convert original Wikimedia Commons URL to thumbnail URL with specified width
	 * Integrates the logic from wikimedia.ts utility
	 */
	const getOptimizedImageUrl = (originalUrl: string, displayWidth: number): string => {
		try {
			const url = new URL(originalUrl);

			// Only process Wikimedia URLs
			if (url.hostname.indexOf("wikimedia.org") === -1) {
				return originalUrl;
			}

			const parts = url.pathname.split("/"); // ["", "wikipedia", "commons", d1, d2, file]
			const file = parts[5];
			if (!file) return originalUrl;

			// Calculate optimal width considering device pixel ratio
			const pixelRatio = PixelRatio.get();
			const optimalWidth = Math.round(displayWidth * pixelRatio);

			// Clamp between 240px minimum and 1280px maximum
			const clampedWidth = Math.min(Math.max(optimalWidth, 240), 1280);

			// Convert to thumbnail URL format
			parts.splice(3, 0, "thumb"); // Insert "thumb" after "commons"
			parts.push(`${clampedWidth}px-${file}`); // Add "<width>px-<file>" at the end
			url.pathname = parts.join("/");

			return url.toString();
		} catch {
			// Fallback to original URL if parsing fails
			return originalUrl;
		}
	};

	const optimizedUri = getOptimizedImageUrl(uri, width);

	// User-Agent header to prevent 403 errors on Android
	const source: ImageSource = {
		uri: optimizedUri,
		headers: {
			"User-Agent": getUserAgent(),
		},
	};

	return (
		<View style={[{ width, height, borderRadius }, style]}>
			<Image
				source={source}
				style={[StyleSheet.absoluteFill, { borderRadius }]}
				contentFit={contentFit}
				cachePolicy="disk"
				transition={200}
				placeholder={placeholder}
				recyclingKey={recyclingKey}
				{...imageProps}
			/>
		</View>
	);
}
