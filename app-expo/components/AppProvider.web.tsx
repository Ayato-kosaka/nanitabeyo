import { LoadScript } from "@react-google-maps/api";
import { ReactNode, useMemo } from "react";
import { Env } from "@/constants/Env";
import { useLocale } from "@/hooks/useLocale";

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

export const AppProvider = ({ children }: { children: ReactNode }) => {
	const locale = useLocale();
	const { language, region } = useMemo(() => deriveLanguageAndRegion(locale), [locale]);
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
