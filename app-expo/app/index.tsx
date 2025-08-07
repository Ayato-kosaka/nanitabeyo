import { useEffect } from "react";
import { useRouter } from "expo-router";
import type { ExternalPathString } from "expo-router";
import * as Localization from "expo-localization";
import * as SplashScreen from "expo-splash-screen";
import { Env } from "@/constants/Env";
import { getResolvedLocale } from "@/lib/i18n";

// 初回表示中はスプラッシュ画面を保持（明示的に後で解除するまで表示）
SplashScreen.preventAutoHideAsync();

/**
 * 🚀 アプリ初回起動時、デバイスのロケールに応じて自動的にリダイレクトする。
 *
 * - `expo-localization` の `getLocales()` を使用し、優先ロケールを抽出
 * - BCP 47 形式に従い、`languageTag` をそのままURLパスとして使用（例: `/ja`, `/en-US`）
 * @returns 画面表示を行わず、ルートリダイレクトのみを行う
 */
export default function App() {
	const router = useRouter();

	useEffect(() => {
		const resolvedLocale = getResolvedLocale(Localization.getLocales?.()[0]?.languageTag);

		if (Env.NODE_ENV === "development") {
			console.log(`[LocaleRedirect] Detected locale: ${resolvedLocale}`);
		}

		const timer = setTimeout(() => {
			// 対応するロケールにリダイレクト
			router.replace(`/${resolvedLocale}` as ExternalPathString);
		}, 0);
		return () => clearTimeout(timer);
	}, []);

	return null;
}
