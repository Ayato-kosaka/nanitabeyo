import { useFonts } from "expo-font";

export function useLocaleFonts(locale: string) {
	const baseFonts: Record<string, any> = {
		"PlusJakarta-Bold": require("@/assets/fonts/PlusJakartaSans-Bold.ttf"),
		"Inter-Regular": require("@/assets/fonts/Inter_24pt-Regular.ttf"),
	};

	const localeFonts: Record<string, any> = {
		ja: {
			NotoSans: require("@/assets/fonts/NotoSansJP-Regular.ttf"),
		},
		ko: {
			NotoSans: require("@/assets/fonts/NotoSansKR-Regular.ttf"),
		},
		zh: {
			NotoSans: require("@/assets/fonts/NotoSansSC-Regular.ttf"),
		},
		ar: {
			NotoSans: require("@/assets/fonts/NotoSansArabic-Regular.ttf"),
		},
		hi: {
			NotoSans: require("@/assets/fonts/NotoSansDevanagari-Regular.ttf"),
		},
		fr: {
			// Latin系はベースフォントでOK
		},
		es: {
			// Latin系はベースフォントでOK
		},
		en: {
			// Latin系はベースフォントでOK
		},
	};

	const selectedFonts = {
		...baseFonts,
		...(localeFonts[locale.split("-")[0]] || {}),
	};

	const [fontsLoaded] = useFonts(selectedFonts);
	return fontsLoaded;
}
