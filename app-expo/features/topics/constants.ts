import { Dimensions } from "react-native";

// Obtain device dimensions to calculate card size
const { width, height } = Dimensions.get("window");

// Width of each topic card within the carousel
export const CARD_WIDTH = width - 32;
// Height of each topic card within the carousel
export const CARD_HEIGHT = (CARD_WIDTH / 9) * 16;

// #633 【設計】Topics 検索のデフォルト値（createDishItemsPromise と handleViewDetails で共通化）
export const DEFAULT_SEARCH_RADIUS = 500; // メートル
export const DEFAULT_PRICE_LEVELS = [
	"PRICE_LEVEL_INEXPENSIVE",
	"PRICE_LEVEL_MODERATE",
	"PRICE_LEVEL_EXPENSIVE",
	"PRICE_LEVEL_VERY_EXPENSIVE",
] as const;

export { width, height };
