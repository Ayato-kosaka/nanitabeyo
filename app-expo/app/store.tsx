import { useEffect } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Env } from "@/constants/Env";
import { useLogger } from "@/hooks/useLogger";

/**
 * Store redirect screen used for the `/store` route.
 *
 * On web/mobile browsers this attempts to open the app via
 * Universal Links / App Links. If the app is not installed, it
 * redirects users to the appropriate store after a short delay.
 * On desktop browsers it simply opens the web root.
 * When rendered inside the native app, it immediately navigates
 * to the app's root screen.
 */
export default function StoreRedirectScreen() {
	const router = useRouter();
	const { logFrontendEvent } = useLogger();

	useEffect(() => {
		const baseUrl = Env.WEB_BASE_URL.endsWith("/") ? Env.WEB_BASE_URL : `${Env.WEB_BASE_URL}/`;
		const ua = navigator.userAgent || "";
		const isIOS = /iPhone|iPad|iPod/i.test(ua);
		const isAndroid = /Android/i.test(ua);
		const isMobile = isIOS || isAndroid;

		logFrontendEvent({
			event_name: "StoreRedirectScreen_open",
			error_level: "log",
			payload: {
				platform: Platform.OS,
				userAgent: ua,
				isIOS,
				isAndroid,
				isMobile,
			},
		});

		if (Platform.OS !== "web") {
			// If this screen is opened inside the app, go to the root screen
			router.replace("/");
			return;
		}

		if (!isMobile) {
			// Desktop: just open the web root
			window.location.replace(baseUrl);
			return;
		}

		// Try to open the app via Universal/App Links
		Linking.openURL(baseUrl);

		if (isIOS) {
			// Additional attempt with custom scheme for iOS
			setTimeout(() => {
				Linking.openURL("nanitabeyo:/");
			}, 100);
		}

		// After 800ms, if the app didn't open, redirect to the store
		const storeUrl = isIOS ? Env.APP_STORE_URL : Env.PLAY_STORE_URL;
		const timer = setTimeout(() => {
			window.location.href = storeUrl;
		}, 800);

		return () => clearTimeout(timer);
	}, [router]);

	return null;
}
