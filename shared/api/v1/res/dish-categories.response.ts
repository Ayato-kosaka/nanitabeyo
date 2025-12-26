export type DishCategoryRecommendationItem = {
	category: string;
	topicTitle: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
};

/** GET /v1/dish-categories/recommendations のレスポンス型 */
export type QueryDishCategoryRecommendationsResponse = DishCategoryRecommendationItem[];

export type ArchetypeType = "classic" | "discovery" | "trend";
