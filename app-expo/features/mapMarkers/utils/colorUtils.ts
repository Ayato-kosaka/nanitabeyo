// app-expo/features/mapMarkers/utils/colorUtils.ts

/**
 * #235 色を正規化（rgb(r,g,b) / #rgb / #rrggbb などを #RRGGBB に寄せる）
 *
 * @param color - 色文字列（rgb(...), #rgb, #rrggbb など）
 * @returns 正規化された色文字列（#RRGGBB 形式）
 */
export const normalizeColor = (color: string): string => {
	const c = (color ?? "").trim();

	// rgb(...) → #RRGGBB
	const rgbMatch = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
	if (rgbMatch) {
		const r = Number(rgbMatch[1]).toString(16).padStart(2, "0");
		const g = Number(rgbMatch[2]).toString(16).padStart(2, "0");
		const b = Number(rgbMatch[3]).toString(16).padStart(2, "0");
		return `#${r}${g}${b}`.toUpperCase();
	}

	// #rgb → #RRGGBB
	const shortHex = c.match(/^#([0-9a-fA-F]{3})$/);
	if (shortHex) {
		const [r, g, b] = shortHex[1].split("");
		return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
	}

	// #rrggbb
	const longHex = c.match(/^#([0-9a-fA-F]{6})$/);
	if (longHex) return `#${longHex[1]}`.toUpperCase();

	// 想定外はそのまま返す
	return c.toUpperCase();
};

// 標準色定義（正規化済み）
export const ACTIVE_COLOR_HEX = "#3477F8";
export const INACTIVE_COLOR_HEX = "#FFFFFF";
