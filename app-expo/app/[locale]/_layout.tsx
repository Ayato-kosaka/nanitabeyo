import { useEffect, useMemo } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFrameworkReady } from "@/hooks/useFrameworkReady";
import { DialogProvider } from "@/contexts/DialogProvider";
import { AuthProvider } from "@/contexts/AuthProvider";
import { SnackbarProvider } from "@/contexts/SnackbarProvider";
import { PaperProvider, Portal } from "react-native-paper";
import { SplashHandler } from "@/components/SplashHandler";
import { AppProvider } from "@/components/AppProvider";
import { HealthCheckInitializer } from "@/components/HealthCheckInitializer";
import { PushTokenRegistration } from "@/components/PushTokenRegistration";
import { MetaAppEventsInitializer } from "@/components/MetaAppEventsInitializer";
import { getPaperTheme } from "@/constants/PaperTheme";
import { useLocaleFonts } from "@/hooks/useLocaleFonts";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n, { getResolvedLocale } from "@/lib/i18n";
import { SeoProvider, SeoHeadRenderer, SeoData } from "@/contexts/SeoContext";
import { Env } from "@/constants/Env";
import { TrueSheetProvider } from "@lodev09/react-native-true-sheet";

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
 * #717 【設計】locale を確定し i18n と同期、SeoProvider で defaults を管理
 * - `useLocale()` によって取得された言語コードを i18n.locale に反映
 * - 不正な形式の場合はトップページへリダイレクト
 * - SeoProvider に locale に応じた defaults を渡す
 * - SeoHeadRenderer を layout 内に1回だけ配置（唯一のHead出力点）
 *
 * @returns 言語判定とバリデーションを行ったレイアウト付きスタック構造
 */
export default function RootLayout() {
	useFrameworkReady();
	const router = useRouter();
	const { locale, isJapanese } = useLocale();
	const scheme = "light"; // light モード 固定（ダークモード対応時に useColorScheme() とする）
	const theme = getPaperTheme(scheme, locale);
	const { logFrontendEvent } = useLogger();

	const fontsLoaded = useLocaleFonts(locale);

	// #717 【設計】locale に応じた SEO defaults を生成
	const seoDefaults: SeoData = useMemo(() => {
		return {
			title: i18n.t("Common.defaultTitle"),
			description: i18n.t("Common.defaultDesc"),
			image: `${Env.WEB_BASE_URL}/og/${isJapanese ? "ja-JP" : "en-US"}.jpg`,
			imageAlt: i18n.t("Common.defaultTitle"),
			siteName: i18n.t("Common.site"),
		};
	}, [locale, isJapanese]);

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

		// #717 【設計】i18n の locale を必ず同期
		i18n.locale = getResolvedLocale(locale);
	}, [locale, router, logFrontendEvent, scheme]);

	if (!fontsLoaded) return null;

	return (
		<>
			{/* #717 【設計】SeoProvider で defaults を管理し、SeoHeadRenderer で唯一のHead出力 */}
			<SeoProvider initialDefaults={seoDefaults}>
				<SeoHeadRenderer />
				<PaperProvider theme={theme}>
					<SnackbarProvider>
						<DialogProvider>
							<TrueSheetProvider>
								<AuthProvider>
									<PushTokenRegistration />
									<MetaAppEventsInitializer />
									<Portal.Host>
										<SplashHandler>
											<HealthCheckInitializer>
												<AppProvider>
													<Stack screenOptions={{ header: () => null }}>
														<Stack.Screen name="(tabs)" options={{ header: () => null }} />
														<Stack.Screen name="+not-found" />
													</Stack>
													<StatusBar style="light" />
												</AppProvider>
											</HealthCheckInitializer>
										</SplashHandler>
									</Portal.Host>
								</AuthProvider>
							</TrueSheetProvider>
						</DialogProvider>
					</SnackbarProvider>
				</PaperProvider>
			</SeoProvider>
		</>
	);
}
