import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";

/** 一つの料理メディア投稿（dish_media）とそれに関連する情報（レストラン、料理、レビュー） */
export type DishMediaEntry = {
	restaurant: SupabaseRestaurants;
	dish: SupabaseDishes;
	dish_media: SupabaseDishMedia & {
		isSaved: boolean
		isLiked: boolean;
		likeCount: number;
		mediaImageUrl: string;
		thumbnailImageUrl: string;
	};
	dish_reviews: (SupabaseDishReviews & {
		username: string;
		isLiked: boolean;
		likeCount: number;
	})[];
};

/** GET /v1/dish-media のレスポンス型 */
export type QueryDishMediaResponse = DishMediaEntry[];

/** POST /v1/dish-media のレスポンス型 */
export type CreateDishMediaResponse = void;

/** POST /v1/dish-media/:id/likes/:userId のレスポンス型 */
export type LikeDishMediaResponse = void;

/** DELETE /v1/dish-media/:id/likes/:userId のレスポンス型 */
export type UnlikeDishMediaResponse = void;

/** POST /v1/dish-media/:id/save/:userId のレスポンス型 */
export type SaveDishMediaResponse = void;
