import { useEffect, useMemo } from "react";
import { Stack, useRootNavigationState, useRouter, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFrameworkReady } from "@/hooks/useFrameworkReady";
import { DialogProvider } from "@/contexts/DialogProvider";
import { AuthProvider } from "@/contexts/AuthProvider";
import { SnackbarProvider } from "@/contexts/SnackbarProvider";
import { PaperProvider, Portal } from "react-native-paper";
import { SplashHandler } from "@/components/SplashHandler";
import { AppProvider } from "@/components/AppProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installCrashReporting, setCrashReportingPathName } from "@/lib/crashReporting";
import { CenteredAppShell } from "@/components/CenteredAppShell";
import { HealthCheckInitializer } from "@/components/HealthCheckInitializer";
import { PushTokenRegistration } from "@/components/PushTokenRegistration";
import { MetaAppEventsInitializer } from "@/components/MetaAppEventsInitializer";
import { OtaUpdateApplier } from "@/components/OtaUpdateApplier";
import { SnsShareIntake } from "@/components/SnsShareIntake";
import { getPaperTheme } from "@/constants/PaperTheme";
import { ThemeProvider, useAppTheme } from "@/contexts/ThemeProvider";
import { useLocaleFonts } from "@/hooks/useLocaleFonts";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n, { getResolvedLocale } from "@/lib/i18n";
import { SeoProvider, SeoHeadRenderer, SeoData } from "@/contexts/SeoContext";
import { resolvePublicLocale, resolveStaticSeoForPath } from "@/constants/seoLocales";
import { TrueSheetProvider } from "@lodev09/react-native-true-sheet";
import { buildLocaleStaticParams, type LocaleStaticParam } from "@/lib/seo/localeStaticParams";

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
	// #1509 【設計】テーマの解決（設定値 + OS スキーム）は Provider の中でしか読めないため、
	// 中身を LocaleLayout へ切り出して ThemeProvider で包む。ここが全画面のテーマの起点になる。
	return (
		<ThemeProvider>
			<LocaleLayout />
		</ThemeProvider>
	);
}

function LocaleLayout() {
	useFrameworkReady();
	const router = useRouter();
	const { locale, isJapanese } = useLocale();


	// #1503 【バグ】i18n の locale 同期は **描画中**に行う（以前は下の useEffect で行っていた）。
	// effect は `expo export` の静的レンダリング（prerender）では走らないため、サーバが焼く HTML
	// だけが既定ロケール（en-US）の文言になり、クライアントの初回描画（URL 由来の ja-JP）と
	// 食い違っていた。その結果が
	//   「Hydration failed because the server rendered HTML didn't match the client.」
	//   = 本番の minified React では **error #418** で、ツリーが丸ごと作り直される。
	// dev ビルド（`expo export --dev`）+ 直リンクで実測し、差分がタブバーのラベル
	//   サーバ: "Search" / クライアント: "さがす"
	// であることまで確認している。
	// locale は URL のセグメント由来でサーバ・クライアントとも同じ値になるため、描画中に
	// 代入しても «その回の描画» の結果は決定的。同じ値なら代入もしない。
	const resolvedLocale = getResolvedLocale(locale);
	if (i18n.locale !== resolvedLocale) i18n.locale = resolvedLocale;
	// #1509 【設計】ここは長く `const scheme = "light"` で固定されていた（= ダークモード未対応）。
	// 設定画面の 3 択（システム追従 / ライト / ダーク）を解決した結果を使う。
	// `getPaperTheme` は元から light / dark の両方を組み立てられるので、渡す値を変えるだけでよい。
	const { scheme, colors } = useAppTheme();
	const theme = useMemo(() => getPaperTheme(scheme, locale), [scheme, locale]);

	const { logFrontendEvent } = useLogger();

	/*
	#1375（実機: 「クラッシュはマップ画面だけじゃない」）**クラッシュを観測できるようにする。**

	これを入れるまで、このアプリはクラッシュを 1 件も観測していなかった。
	クラッシュレポート SDK も、JS のグローバルエラーハンドラも、未処理 Promise の口も無く、
	`ErrorBoundary` が拾えるのは **レンダー中の例外だけ**だった。
	つまり «他の画面では報告が無い» のではなく «見えていない» だけで、
	オーナーが実機で踏んで言ってくるまで誰も知れない状態だった。

	仕掛けは `lib/crashReporting.ts`（何が捕まって何が捕まらないかの表もそこにある）。
	記録は既存の `frontend_event_logs` へ流れるので、日次の error-triage が自動で起票する。
	*/
	useEffect(() => installCrashReporting(), []);
	const crashPathName = usePathname();
	useEffect(() => {
		setCrashReportingPathName(crashPathName);
	}, [crashPathName]);

	// #1027 【バグ】ルートナビゲータがマウントされる前に router.replace() を呼ぶと expo-router の
	// assertIsReady が
	//   「Attempted to navigate before mounting the Root Layout component.」
	// を投げ、**JS 例外でアプリごとクラッシュする**（Detox の Android release run 30391843038 で実測）。
	// useRootNavigationState() は準備完了までは undefined / key 無しを返すので、これを遷移の可否判定に使う。
	// ナビゲータが後から準備完了すると key が入って再レンダーされ、下の useEffect が再実行される
	const rootNavigationState = useRootNavigationState();
	const isNavigationReady = rootNavigationState?.key != null;

	// #1092 【設計】フォントの読み込みで最初の描画をブロックしない（以前はこの下に
	// `if (!fontsLoaded) return null;` があり、UI が 1 つも描画されないまま待っていた）。
	// app-expo 配下（node_modules 除く）で `fontFamily` を宣言しているのは `constants/MD3Fonts/` の
	// 6 ファイルだけで、その値は `constants/PaperTheme.ts` 経由で react-native-paper の MD3 テーマの
	// `fonts` にしか渡らない。そのテーマで実際にテキストを描画するのは
	// `contexts/DialogProvider.tsx` と `contexts/SnackbarProvider.tsx` の 2 つだけである
	// （他の react-native-paper 利用箇所は Portal / Portal.Host とテーマ定義そのもので、テキストを持たない）。
	// つまり検索画面もタブバーもプロフィールも元から OS 既定フォントで描画されており、
	// ja で 5.5MB の NotoSansJP-Regular.ttf がブロックしていた相手は
	// 「起動直後には出ないダイアログとスナックバー」だった。よって早期 return を外しても
	// 起動直後の見た目は変わらず、フォント差し替えが起こりうるのは Dialog/Snackbar のテキストだけ。
	// 読み込み自体は継続させたいので呼び出しは残す（揃った時点で Paper のテーマに反映される）。
	// この不変条件は `__tests__/localeLayoutFontGate.test.ts` で固定している。
	useLocaleFonts(locale);

	// #717 【設計】locale に応じた SEO defaults を生成
	//
	// #1194 ⚠️ **パスも見ること。** 友達投票の共有 URL は `[shareToken]` が動的セグメントで
	// prerender の対象にならず、`useSeo`（useFocusEffect）は prerender で走らないため、
	// ここで決めた値がそのまま SNS のクローラに読まれる初回 HTML になる。
	// パスを見ないと「アプリの紹介文」が投票の招待カードとして出てしまう（実機で指摘を受けた）。
	const seoPathname = usePathname();
	const seoDefaults: SeoData = useMemo(
		() => resolveStaticSeoForPath(resolvePublicLocale(locale), seoPathname),
		[locale, seoPathname],
	);

	useEffect(() => {
		// #1027 【バグ】locale は usePathname() の第 1 セグメントなので、遷移の途中経過では
		// 空文字になりうる（例: `/` にいる一瞬）。これを「不正なロケール」と誤判定して `/` へ
		// リダイレクトすると、`/` → `/ja-JP` へ飛ばす app/index.tsx と押し合いになるうえ、
		// ナビゲータ未準備のタイミングだと上記のクラッシュを引き起こす。
		// 空のときは「まだ確定していない」とみなして何もしない（確定すれば再実行される）
		if (!locale) return;

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
			// #1027 【バグ】ナビゲータ未準備の間は遷移を見送る。準備完了で再実行され、そこで初めて飛ぶ
			if (!isNavigationReady) return;

			logFrontendEvent({
				event_name: "locale_validation_failed",
				error_level: "warn",
				payload: { locale, redirectTo: "/" },
			});
			router.replace("/");
			return;
		}

		// #717 【設計】i18n の locale を必ず同期
		// #1503 実際の代入はこのコンポーネントの描画中（上部）へ移した。prerender では effect が
		// 走らず、サーバ HTML だけ英語のまま焼かれて hydration が壊れるため。
	}, [locale, router, logFrontendEvent, scheme, isNavigationReady]);

	return (
		<>
			{/* #717 【設計】SeoProvider で defaults を管理し、SeoHeadRenderer で唯一のHead出力 */}
			<SeoProvider initialDefaults={seoDefaults}>
				<SeoHeadRenderer />
				<PaperProvider theme={theme}>
					{/* #958 【設計】SnackbarProvider/DialogProvider(Portalの元)/Portal.Host をまとめて
					    包む位置に設置。Dialog(Portal経由)・Snackbar(素のabsolute)いずれも
					    「最も近いposition付き祖先」基準で幅が決まるため、個別変更なしに
					    同じ中央カラムへ自動的に収まる */}
					<CenteredAppShell>
						<SnackbarProvider>
							<DialogProvider>
								<TrueSheetProvider>
									<AuthProvider>
										<PushTokenRegistration />
										<MetaAppEventsInitializer />
										{/* #1641 OTA を «次の起動» まで待たせない（UI 無し）。
										    既定のままだと利用者が触る JS は常に 1 つ前になる */}
										<OtaUpdateApplier />
										{/* #1400 共有された URL の取り込み入口（UI 無し）。
										    PR1 では受け取り口が «共有なし» を返すので no-op */}
										<SnsShareIntake />
										<Portal.Host>
											<SplashHandler>
												<HealthCheckInitializer>
													<AppProvider>
														{/* #940 【設計】render中の未捕捉例外で白画面になるのを防ぐ最終防波堤。
														    再試行はアプリのルートへ戻すことで安全な状態に復帰させる */}
														<ErrorBoundary onRetry={() => router.replace("/")}>
															{/*
															#1629【27】**Stack へ `contentStyle` を必ず与える。**

															expo-router の NavigationContainer は既定で react-navigation の
															`DefaultTheme` を使う（`DarkTheme` を渡している箇所はリポジトリに無い）。
															`DefaultTheme.colors.background` は `rgb(242,242,242)` の明るいグレーで、
															画面が全面を塗り切らない瞬間 — 遷移アニメーションの最中、モーダルの背後、
															画面のマウント直後 — に**ダークモードでもそこだけ明るく光る**。

															⚠️ これは «色を直書きした» のではなく «色を書かなかった» ことで起きるので、
															   `assert-no-hardcoded-colors.mjs` には原理的に検出できない。
															*/}
															<Stack screenOptions={{ header: () => null, contentStyle: { backgroundColor: colors.background } }}>
																<Stack.Screen name="(tabs)" options={{ header: () => null }} />
																{/* #1375 実機確認（2 巡目）: ＋ からの取り込みは iOS ネイティブのシート
																    （背後の画面が縮む pageSheet）で出す。下スワイプで閉じるのは
																    ネイティブのジェスチャに任せる（自前 PanResponder は web の保険） */}
																<Stack.Screen
																	name="sns-import"
																	options={{ presentation: "modal", header: () => null }}
																/>
																<Stack.Screen name="+not-found" />
															</Stack>
														</ErrorBoundary>
														<StatusBar style="light" />
													</AppProvider>
												</HealthCheckInitializer>
											</SplashHandler>
										</Portal.Host>
									</AuthProvider>
								</TrueSheetProvider>
							</DialogProvider>
						</SnackbarProvider>
					</CenteredAppShell>
				</PaperProvider>
			</SeoProvider>
		</>
	);
}

/**
 * 🌍 #721 ロケールごとに実体の HTML を事前生成させる。
 *
 * expo-router はこの export を見て動的セグメントを展開する。
 * 実装と設計の背景は `@/lib/seo/localeStaticParams` を参照
 * （テストから supabase を読み込まずに触れるよう切り出してある）。
 */
export function generateStaticParams(): LocaleStaticParam[] {
	return buildLocaleStaticParams();
}
