/** GET /v1/dish-categories/recommendations のレスポンス型 */
export type QueryDishCategoryRecommendationsResponse = {
	category: string;
	topicTitle: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
}[];
