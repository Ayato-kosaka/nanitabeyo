import { Platform, Alert } from "react-native";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import { Env } from "@/constants/Env";

/**
 * Generate a shareable URL based on the current pathname
 * @param pathname Current pathname from usePathname()
 * @returns Full shareable URL
 */
export const generateShareUrl = (pathname: string): string => {
  const baseUrl = Env.WEB_BASE_URL || "https://example.com";
  // Remove any leading slash to avoid double slashes
  const cleanPathname = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return `${baseUrl}/${cleanPathname}`;
};

/**
 * Handle share functionality with platform-specific behavior
 * @param url URL to share
 * @param title Optional title for the share
 * @param onSuccess Callback for successful share
 * @param onError Callback for share error
 */
export const handleShare = async (
  url: string,
  title?: string,
  onSuccess?: () => void,
  onError?: (error: string) => void
): Promise<void> => {
  try {
    if (Platform.OS === "web") {
      // Web platform - try Web Share API first, fallback to clipboard
      if (navigator.share) {
        await navigator.share({
          title: title || "Check this out!",
          url: url,
        });
        onSuccess?.();
      } else {
        // Fallback to clipboard for unsupported browsers
        await Clipboard.setStringAsync(url);
        Alert.alert("Copied!", "Link copied to clipboard");
        onSuccess?.();
      }
    } else {
      // iOS/Android - try native sharing first, fallback to clipboard
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(url, {
          UTI: "public.url",
          mimeType: "text/plain",
        });
        onSuccess?.();
      } else {
        // Fallback to clipboard
        await Clipboard.setStringAsync(url);
        Alert.alert("Copied!", "Link copied to clipboard");
        onSuccess?.();
      }
    }
  } catch (error) {
    // Always fallback to clipboard on any error
    try {
      await Clipboard.setStringAsync(url);
      Alert.alert("Copied!", "Link copied to clipboard");
      onSuccess?.();
    } catch (clipboardError) {
      const errorMessage = "Failed to share content";
      Alert.alert("Error", errorMessage);
      onError?.(errorMessage);
    }
  }
};