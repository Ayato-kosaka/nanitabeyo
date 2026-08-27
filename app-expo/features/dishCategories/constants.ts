import { Dimensions } from "react-native";
import { allPriceLevelValues } from "../search/constants";

// Obtain device dimensions to calculate card size
const { width, height } = Dimensions.get("window");

// #958 【修正】CARD_WIDTH/CARD_MAX_HEIGHT はここに定義されていたが、
// Dimensions.get("window") のモジュール評価時1回読みでリサイズに追従せず、
// web では CenteredAppShell が収める中央カラム幅とも一致しなかった。
// features/dishCategories/hooks/useDishCategoryCardSize.ts の useContentWidth() ベースの計算に置き換えた。

// #633 【設計】DishCategories 検索のデフォルト値（createDishItemsPromise と handleViewDetails で共通化）
export const DEFAULT_SEARCH_RADIUS = 500; // メートル
export const DEFAULT_PRICE_LEVELS = allPriceLevelValues;

export { width, height };
