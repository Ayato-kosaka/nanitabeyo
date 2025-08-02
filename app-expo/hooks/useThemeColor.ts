/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from "@/constants/PaperTheme";
import { useColorScheme } from "@/hooks/useColorScheme";

export function useThemeColor(
	props: { light?: string; dark?: string },
	colorName: keyof typeof Colors.light & keyof typeof Colors.dark,
): string {
	const theme = useColorScheme() ?? "light";
	const colorFromProps = props[theme];

	if (colorFromProps) {
		return colorFromProps;
	}

	const color = Colors[theme][colorName];

	if (typeof color === "string") {
		return color;
	}

	console.warn(`Color "${colorName}" is not a string. Got:`, color);
	return "#000"; // fallback color
}
