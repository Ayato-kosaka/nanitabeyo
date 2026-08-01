import type { SupabaseDishCategoryFeatures } from "../../../converters/convert_dish_category_features";

// #876 深掘り候補として返す feature_type はAPI実装側で以下に絞る。
// - budget_intent
// - dining_pace
// - taste
// - core_ingredient
//
// #876 feature_key の想定値:
// - budget_intent: inexpensive, moderate, expensive, very_expensive
// - dining_pace: quick, leisurely
// - taste: sweet, spicy, healthy, junk
// - core_ingredient: meat, fish, rice, noodle
//
// レスポンス型ではDB由来の特徴量型に合わせ、feature_type / feature_key のunion型は定義しない。
export type DishCategoryDeepDiveFeature = Pick<SupabaseDishCategoryFeatures, "feature_type" | "feature_key" | "score">;

export type DishCategoryRecommendationItem = {
	category: string;
	topicTitle: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
	deepDiveFeatures: DishCategoryDeepDiveFeature[];
	/** #954 呼び出しユーザーがこのカテゴリを reactions(action_type=save) 済みか */
	isSaved: boolean;
};

/** GET /v1/dish-categories/recommendations のレスポンス型 */
export type QueryDishCategoryRecommendationsResponse = DishCategoryRecommendationItem[];

export type ArchetypeType = "classic" | "discovery" | "trend";
