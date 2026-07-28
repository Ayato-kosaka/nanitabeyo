import { useEffect } from "react";
import { useRootNavigationState, useRouter } from "expo-router";
import type { ExternalPathString } from "expo-router";
import * as Localization from "expo-localization";
import * as SplashScreen from "expo-splash-screen";
import { Env } from "@/constants/Env";
import { getResolvedLocale } from "@/lib/i18n";
import * as WebBrowser from "expo-web-browser";
WebBrowser.maybeCompleteAuthSession();

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

	// #1027 【バグ】ルートナビゲータのマウント前に router.replace() を呼ぶと expo-router の
	// assertIsReady が「Attempted to navigate before mounting the Root Layout component.」を投げ、
	// JS 例外でアプリごとクラッシュする。setTimeout(0) だけでは「次のタスクまでに必ずマウント済み」を
	// 保証できない（release ビルド + 低速端末では間に合わないことがある）ため、
	// ナビゲータの準備完了を明示的に待ってからリダイレクトする
	const rootNavigationState = useRootNavigationState();
	const isNavigationReady = rootNavigationState?.key != null;

	useEffect(() => {
		if (!isNavigationReady) return;

		const resolvedLocale = getResolvedLocale(Localization.getLocales?.()[0]?.languageTag);

		if (Env.NODE_ENV === "development") {
			console.log(`[LocaleRedirect] Detected locale: ${resolvedLocale}`);
		}

		const timer = setTimeout(() => {
			// 対応するロケールにリダイレクト
			router.replace(`/${resolvedLocale}` as ExternalPathString);
		}, 0);
		return () => clearTimeout(timer);
	}, [isNavigationReady]);

	return null;
}
