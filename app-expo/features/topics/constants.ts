import { Dimensions } from "react-native";
import { allPriceLevelValues } from "../search/constants";

// Obtain device dimensions to calculate card size
const { width, height } = Dimensions.get("window");

// Width of each topic card within the carousel
export const CARD_WIDTH = width - 32;
// Height of each topic card within the carousel
export const CARD_MAX_HEIGHT = (CARD_WIDTH / 9) * 16; // 16:9 のアスペクト比を維持

// #633 【設計】Topics 検索のデフォルト値（createDishItemsPromise と handleViewDetails で共通化）
export const DEFAULT_SEARCH_RADIUS = 500; // メートル
export const DEFAULT_PRICE_LEVELS = allPriceLevelValues;

export { width, height };
