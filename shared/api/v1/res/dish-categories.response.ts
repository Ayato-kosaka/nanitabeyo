export type DishCategoryRecommendationItem = {
	category: string;
	topicTitle: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
	macroGenre?: string | null;
	tagline?: string;
};

/** GET /v1/dish-categories/recommendations のレスポンス型 */
export type QueryDishCategoryRecommendationsResponse = {
	items: DishCategoryRecommendationItem[];
	meta: {
		source: 'feature_scoring' | 'claude_fallback';
		candidateCount: number;
		returnedCount: number;
	};
};

export type ArchetypeType = "classic" | "discovery" | "trend";

