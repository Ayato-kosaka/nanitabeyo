import React, { createContext, useContext, ReactNode, useMemo } from "react";
import { useJsApiLoader } from "@react-google-maps/api";
import { Env } from "@/constants/Env";
import { useLocale } from "@/hooks/useLocale";

// #938 【仕様】libraries はモジュールスコープの定数にする。インライン配列リテラルを
// props に渡すと、AppProvider が再レンダーされる度に「新しい配列」と判定され、
// @react-google-maps/api が Performance warning とともにスクリプトを再読み込みしてしまう。
const GOOGLE_MAPS_LIBRARIES: "places"[] = ["places"];

type MapsLoaderContextType = {
	isLoaded: boolean;
	loadError: Error | undefined;
};

const MapsLoaderContext = createContext<MapsLoaderContextType | undefined>(undefined);

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

/**
 * #938 【責務】Google Maps JS SDK の読み込みをアプリ全体で1回だけ行うための Provider(Web専用)。
 *
 * 従来は `<LoadScript>` をレンダーしていたため、渡す props(特に libraries)の参照が
 * 変わるたびに再読み込みが走っていた。`useJsApiLoader` はモジュール内でロード状態を
 * シングルトン管理するため、libraries の参照不一致による不要な再読み込みは起きない。
 * language/region が実際に変わった場合(=利用者が言語設定を変更した場合)のみ、
 * Google Maps JS API の仕様上スクリプトの再読み込みが必要になる(これは正常な動作)。
 */
export const MapsLoaderProvider = ({ children }: { children: ReactNode }) => {
	const { locale } = useLocale();
	const { language, region } = useMemo(() => deriveLanguageAndRegion(locale), [locale]);

	const { isLoaded, loadError } = useJsApiLoader({
		id: "google-map-script",
		googleMapsApiKey: Env.GOOGLE_MAPS_WEB_API_KEY,
		language,
		region,
		libraries: GOOGLE_MAPS_LIBRARIES,
	});

	return <MapsLoaderContext.Provider value={{ isLoaded, loadError }}>{children}</MapsLoaderContext.Provider>;
};

/**
 * @throws Error - MapsLoaderProvider の外で使用された場合
 */
export const useMapsLoader = (): MapsLoaderContextType => {
	const context = useContext(MapsLoaderContext);
	if (!context) {
		throw new Error("[useMapsLoader] This hook must be used within a <MapsLoaderProvider>.");
	}
	return context;
};
