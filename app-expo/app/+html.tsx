// app/+html.tsx
import { Env } from "@/constants/Env";
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

const WEB_BASE_URL = Env.WEB_BASE_URL.replace(/\/+$/, "");
const SITE_NAME = "なに食べよ";
const THEME_COLOR = "#ffffff";

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
				<link rel="icon" href="/favicon.ico" sizes="any" />
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
				<link rel="icon" type="image/png" sizes="64x64" href="/favicon-64x64.png" />
				<link rel="apple-touch-icon" href="/android-chrome-192x192.png" />

				{/* Theme color（ライト/ダーク両方） */}
				<meta name="theme-color" media="(prefers-color-scheme: light)" content={THEME_COLOR} />
				<meta name="theme-color" media="(prefers-color-scheme: dark)" content={THEME_COLOR} />

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
			</head>
			<body>{children}</body>
		</html>
	);
}
