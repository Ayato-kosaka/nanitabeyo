import { LoadScript } from "@react-google-maps/api";
import { ReactNode, useEffect, useMemo, useRef } from "react";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { usePathname } from "expo-router";
import { Env } from "@/constants/Env";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";

function deriveLanguageAndRegion(locale: string): { language: string; region: string } {
	// locale examples: 'ja', 'en-US', 'zh-Hant-TW'
	const parts = locale.split("-");
	const language = parts[0];
	// Find 2-letter region (last part with length 2 and alpha)
	let region = parts.findLast?.((p) => /^[a-zA-Z]{2}$/.test(p)) || parts[1] || "US";
	region = region.toUpperCase();
	// Fallback mapping
	if (!region) {
		if (language === "ja") region = "JP";
		else if (language === "en") region = "US";
		else region = language.toUpperCase();
	}
	return { language, region };
}

// #957 【設計】web のみ RUM(Real User Monitoring) として Core Web Vitals を計測する。
// 外部 SaaS(Sentry/GA等)は導入せず、既存の logFrontendEvent → Cloud Logging → BigQuery の
// 経路にそのまま乗せる(event_name: "web_vital"。詳細は .codex/bigquery/event-catalog.md 参照)。
// native(iOS/Android)は Web Vitals がブラウザ固有指標のため対象外(#957 決定事項)。
function useWebVitalsReporting() {
	const { logFrontendEvent } = useLogger();
	const pathname = usePathname();

	// #957 【設計】各指標のコールバックは PerformanceObserver ベースで発火タイミングが
	// 不定(ページ離脱時・INPは操作の都度 delta 更新等)のため、常に最新の pathname を
	// ref 経由で参照する(コールバック登録自体はマウント時の1回のみで良い)
	const pathnameRef = useRef(pathname);
	useEffect(() => {
		pathnameRef.current = pathname;
	}, [pathname]);

	const logFrontendEventRef = useRef(logFrontendEvent);
	logFrontendEventRef.current = logFrontendEvent;

	useEffect(() => {
		const reportWebVital = (metric: Metric) => {
			logFrontendEventRef.current({
				event_name: "web_vital",
				error_level: "log",
				payload: {
					metric: metric.name,
					value: metric.value,
					rating: metric.rating,
					path: pathnameRef.current,
				},
			});
		};

		onLCP(reportWebVital);
		onINP(reportWebVital);
		onCLS(reportWebVital);
		onTTFB(reportWebVital);
		onFCP(reportWebVital);
		// #957 【設計】web-vitals の on* はページ生存期間中コールバックを保持し続ける想定の API
		// (登録解除手段が提供されていない)ため、マウント時の1回のみ登録する
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}

export const AppProvider = ({ children }: { children: ReactNode }) => {
	const { locale } = useLocale();
	const { language, region } = useMemo(() => deriveLanguageAndRegion(locale), [locale]);
	useWebVitalsReporting();
	return (
		<LoadScript
			googleMapsApiKey={Env.GOOGLE_MAPS_WEB_API_KEY}
			language={language}
			region={region}
			libraries={["places"]}>
			{children}
		</LoadScript>
	);
};
