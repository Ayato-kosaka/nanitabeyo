import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";
import { RestaurantsEntity } from "./restaurants.response";

/** 一つの料理メディア投稿（dish_media）とそれに関連する情報（レストラン、料理、レビュー） */
export type DishMediaEntry = {
	restaurant: RestaurantsEntity;
	dish: SupabaseDishes & {
		reviewCount: number;
		averageRating: number;
	};
	dish_media: SupabaseDishMedia & {
		isMine: boolean;
		isSaved: boolean;
		isLiked: boolean;
		likeCount: number;
		/** 投稿メディアの署名付きCDN URL（派生サイズ） */
		mediaUrl: string;
		/** 投稿サムネイル画像の署名付きCDN URL（派生サイズ） */
		thumbnailImageUrl: string;
	};
	dish_reviews: (SupabaseDishReviews & {
		username: string;
		isLiked: boolean;
		likeCount: number;
	})[];
};

/** GET /v1/dish-media/search のレスポンス型 */
export type SearchDishMediaResponse = DishMediaEntry[];

/** GET /v1/dish-media?ids=... のレスポンス型 */
export type QueryDishMediaByIdsResponse = {
	items: DishMediaEntry[];
	notFound: string[];
};

/** POST /v1/dish-media のレスポンス型 */
export type CreateDishMediaResponse = SupabaseDishMedia;

/** POST /v1/dish-media/view のレスポンス型 */
export type CreateDishMediaViewResponse = {
	id: string;
	dish_media_id: string;
	impression_id: string | null;
	stored: boolean;
	analysis_applied: boolean;
};
