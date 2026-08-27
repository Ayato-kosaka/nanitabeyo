// app/+html.tsx
import { Env } from "@/constants/Env";
import { Palettes } from "@/constants/Palette";
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

const WEB_BASE_URL = Env.WEB_BASE_URL.replace(/\/+$/, "");
const SITE_NAME = "なに食べよ";

/*
#1629【設計】ここは web の HTML シェルで、**ThemeProvider の外側**である。
React のフックが使えないので `useAppTheme()` は呼べず、アプリ内の 3 択（システム追従 /
ライト / ダーク）も参照できない。そこで地の色だけは OS の `prefers-color-scheme` で
出し分ける。値は直書きせず Palette から読む（色の正本を 2 つにしないため）。

- ライトの値は `surface`（＝白）。今までの実装と同じ色で、ライトの見た目は 1px も変わらない
- ダークの値は `background`。ここを白のままにすると、アプリ本体が暗くなっても
  スクロールの跳ね返り・アドレスバーの下・prerender 済み HTML が出ている一瞬だけ
  白が見える（web はスプラッシュで隠せない）
- OS がダークで **アプリ内の設定だけライト** のときは、この地とアプリ本体がずれる
  （スクロールの跳ね返りの外側だけが暗い）。ここからアプリ側の設定は読めないので、
  ThemeProvider の JSDoc にある «web の初回 1 フレーム» と同じ既知の制約として扱う
*/
const SHELL_BACKGROUND_LIGHT = Palettes.light.surface;
const SHELL_BACKGROUND_DARK = Palettes.dark.background;

/** OS のスキームで地の色を出し分ける CSS。`color-scheme` はスクロールバー等の OS 描画にも効く */
const SHELL_BACKGROUND_CSS = `
:root { color-scheme: light dark; }
html, body { background-color: ${SHELL_BACKGROUND_LIGHT}; }
@media (prefers-color-scheme: dark) {
	html, body { background-color: ${SHELL_BACKGROUND_DARK}; }
}
`;

export default function Root({ children }: PropsWithChildren) {
	// ここでは <html lang> を固定しない（ルートごとに [locale]/_layout.tsx で上書き）
	return (
		<html>
			<head>
				<meta charSet="utf-8" />
				<meta httpEquiv="X-UA-Compatible" content="IE=edge" />
				<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

				{/* Robots（プレビューは noindex） */}
				<meta name="robots" content={"index, follow"} />

				{/* PWA / Manifest */}
				<link rel="manifest" href="/manifest.json" />
				<meta name="application-name" content={SITE_NAME} />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-title" content={SITE_NAME} />
				<meta name="apple-mobile-web-app-status-bar-style" content="default" />

				{/* Icons / Favicons */}
				<link rel="icon" href="/favicon.20260207.ico" sizes="any" />
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.20260207.png" />
				<link rel="icon" type="image/png" sizes="64x64" href="/favicon-64x64.20260207.png" />
				<link rel="apple-touch-icon" href="/android-chrome-192x192.png" />

				{/* Theme color（ライト/ダーク両方）。値は Palette が正本 */}
				<meta name="theme-color" media="(prefers-color-scheme: light)" content={SHELL_BACKGROUND_LIGHT} />
				<meta name="theme-color" media="(prefers-color-scheme: dark)" content={SHELL_BACKGROUND_DARK} />

				{/* Preconnect（必要に応じて） */}
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				{/* <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" /> */}

				{/* JSON-LD（WebSite / Organization） */}
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify({
							"@context": "https://schema.org",
							"@type": "WebSite",
							name: SITE_NAME,
							url: WEB_BASE_URL,
						}),
					}}
				/>
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify({
							"@context": "https://schema.org",
							"@type": "Organization",
							name: SITE_NAME,
							url: WEB_BASE_URL,
							logo: `${WEB_BASE_URL}/logo192.png`,
						}),
					}}
				/>

				<ScrollViewStyleReset />

				{/* #1629 地の色を OS のスキームで出し分ける（上のコメント参照） */}
				<style dangerouslySetInnerHTML={{ __html: SHELL_BACKGROUND_CSS }} />
			</head>
			<body>{children}</body>
		</html>
	);
}
