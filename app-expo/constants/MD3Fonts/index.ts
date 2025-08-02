import { arFonts } from "./fonts.ar";
import { defaultFonts } from "./fonts.default";
import { hiFonts } from "./fonts.hi";
import { jaFonts } from "./fonts.ja";
import { koFonts } from "./fonts.ko";
import { zhFonts } from "./fonts.zh";

export function getFontsForLocale(locale: string) {
	const lang = locale.split("-")[0];

	switch (lang) {
		case "ja":
			return jaFonts;
		case "ko":
			return koFonts;
		case "zh":
			return zhFonts;
		case "ar":
			return arFonts;
		case "hi":
			return hiFonts;
		default:
			return defaultFonts;
	}
}
