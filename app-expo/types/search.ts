import type { DishCategoryDeepDiveFeature, DishMediaEntry, LocationDetailsResponse } from "@shared/api/v1/res";

export type SearchParams = Omit<LocationDetailsResponse, "viewport"> & {
	timeSlot: "morning" | "lunch" | "dinner" | "late_night";
	scene: "solo" | "date" | "friends" | "family" | "drinking";
	mood?: "light" | "normal" | "heavy";
	taste?: "sweet" | "spicy" | "healthy" | "junk";
	coreIngredient?: "meat" | "fish" | "rice" | "noodle";
	diningPace?: "quick" | "leisurely";
	distance: number; // meters
	priceLevels: string[]; // price levels
	locationQuery: string; // #674 【仕様】検索画面で入力されたロケーション表示用文字列
};

// #633 【設計】DishCategoryRecommendation 型から dishItemsPromise を削除（重い処理はユーザー操作後に限定）
export interface DishCategoryRecommendation {
	category: string;
	title: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
	deepDiveFeatures?: DishCategoryDeepDiveFeature[];
	isHidden?: boolean;
	/** #954 推薦API取得時点でユーザーが既に保存済みか。カード再訪時の初期表示に使う */
	isSaved?: boolean;
}
