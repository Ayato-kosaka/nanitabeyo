import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFrameworkReady } from "@/hooks/useFrameworkReady";
import { DialogProvider } from "@/contexts/DialogProvider";
import { AuthProvider } from "@/contexts/AuthProvider";
import { SnackbarProvider } from "@/contexts/SnackbarProvider";
import { PaperProvider, Portal } from "react-native-paper";
import { SplashHandler } from "@/components/SplashHandler";
import { AppProvider } from "@/components/AppProvider";
import { HealthCheckInitializer } from "@/components/HealthCheckInitializer";
import { useColorScheme } from "react-native";
import { getPaperTheme } from "@/constants/PaperTheme";
import { useLocaleFonts } from "@/hooks/useLocaleFonts";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n, { getResolvedLocale } from "@/lib/i18n";

/**
 * 🌍 BCP 47 言語タグが妥当な形式かを検証するユーティリティ関数。
 *
 * @param tag - 対象の言語コード（例: "ja", "en-US", "zh-Hant"）
 * @returns 正常な言語タグであれば true、不正な形式なら false
 */
const isValidBcp47Tag = (tag: string): boolean => {
	const bcp47Pattern = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
	return bcp47Pattern.test(tag);
};

/**
 * 🌐 言語スコープレイアウト（[local]ルーティングに対応）
 *
 * - `useLocale()` によって取得された言語コードを i18n.locale に反映
 * - 不正な形式の場合はトップページへリダイレクト
 * - アプリ全体で BCP 47 に準拠した多言語対応を保証する
 *
 * @returns 言語判定とバリデーションを行ったレイアウト付きスタック構造
 */
export default function RootLayout() {
	useFrameworkReady();
	const router = useRouter();
	const locale = useLocale();
	const scheme = useColorScheme();
	const theme = getPaperTheme(scheme, locale);
	const { logFrontendEvent } = useLogger();

	const fontsLoaded = useLocaleFonts(locale);

	useEffect(() => {
		const isLocaleSupported = isValidBcp47Tag(locale);

		// Log locale initialization
		logFrontendEvent({
			event_name: "locale_initialized",
			error_level: "log",
			payload: {
				locale,
				isSupported: isLocaleSupported,
				colorScheme: scheme,
			},
		});

		if (!isLocaleSupported) {
			logFrontendEvent({
				event_name: "locale_validation_failed",
				error_level: "warn",
				payload: { locale, redirectTo: "/" },
			});
			router.replace("/");
			return;
		}

		i18n.locale = getResolvedLocale(locale);
	}, [locale, scheme, router, logFrontendEvent]);

	if (!fontsLoaded) return null;

	return (
		<SafeAreaProvider>
			<PaperProvider theme={theme}>
				<SnackbarProvider>
					<DialogProvider>
						<AuthProvider>
							<Portal.Host>
								<SplashHandler>
									<HealthCheckInitializer>
										<GestureHandlerRootView style={{ flex: 1 }}>
											<AppProvider>
												<Stack screenOptions={{ header: () => null }}>
													<Stack.Screen name="(tabs)" options={{ header: () => null }} />
													<Stack.Screen name="+not-found" />
												</Stack>
												<StatusBar style="light" />
											</AppProvider>
										</GestureHandlerRootView>
									</HealthCheckInitializer>
								</SplashHandler>
							</Portal.Host>
						</AuthProvider>
					</DialogProvider>
				</SnackbarProvider>
			</PaperProvider>
		</SafeAreaProvider>
	);
}
