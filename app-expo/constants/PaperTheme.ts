import { MD3DarkTheme } from "react-native-paper";
import { MD3Colors } from "react-native-paper/lib/typescript/types";
import { MaterialTheme } from "./MaterialColor";
import { getFontsForLocale } from "./MD3Fonts";
import { ColorSchemeName } from "react-native";

function hexToRgba(hex: string, alpha: number): string {
	const raw = hex.replace("#", "");

	const bigint = parseInt(raw, 16);
	const r = (bigint >> 16) & 255;
	const g = (bigint >> 8) & 255;
	const b = bigint & 255;

	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const Colors: {
	light: MD3Colors;
	dark: MD3Colors;
} = {
	light: {
		...MaterialTheme.schemes.light,
		surfaceDisabled: hexToRgba(MaterialTheme.schemes.light.onSurface, 0.12),
		onSurfaceDisabled: hexToRgba(MaterialTheme.schemes.light.onSurface, 0.38),
		backdrop: hexToRgba(MaterialTheme.schemes.light.onSurface, 0.4),
		elevation: {
			level0: "transparent",
			level1: MaterialTheme.schemes.light.surface,
			level2: MaterialTheme.schemes.light.surface,
			level3: MaterialTheme.schemes.light.surface,
			level4: MaterialTheme.schemes.light.surface,
			level5: MaterialTheme.schemes.light.surface,
		},
	},
	dark: {
		...MaterialTheme.schemes.dark,
		surfaceDisabled: hexToRgba(MaterialTheme.schemes.dark.onSurface, 0.12),
		onSurfaceDisabled: hexToRgba(MaterialTheme.schemes.dark.onSurface, 0.38),
		backdrop: hexToRgba(MaterialTheme.schemes.dark.onSurface, 0.4),
		elevation: {
			level0: "transparent",
			level1: MaterialTheme.schemes.dark.surface,
			level2: MaterialTheme.schemes.dark.surface,
			level3: MaterialTheme.schemes.dark.surface,
			level4: MaterialTheme.schemes.dark.surface,
			level5: MaterialTheme.schemes.dark.surface,
		},
	},
};

export function getPaperTheme(scheme: ColorSchemeName, locale: string) {
	return {
		...MD3DarkTheme,
		colors: {
			...MD3DarkTheme.colors,
			...Colors[scheme ?? "light"],
		},
		fonts: getFontsForLocale(locale),
	};
}
