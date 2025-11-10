import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";

/** 一つの料理メディア投稿（dish_media）とそれに関連する情報（レストラン、料理、レビュー） */
export type DishMediaEntry = {
	restaurant: SupabaseRestaurants;
	dish: SupabaseDishes & {
		reviewCount: number;
		averageRating: number;
	};
	dish_media: SupabaseDishMedia & {
		isSaved: boolean;
		isLiked: boolean;
		likeCount: number;
		/** 投稿メディアの署名付きURL（原本） */
		mediaUrl: string;
		/** 投稿メディアの派生サイズCDN URL群 */
		mediaUrls: {
			xl: string; // 1024x1024
		}
		/** 投稿サムネイル画像の署名付きURL（原本） */
		thumbnailImageUrl: string;
		/** 投稿サムネイル画像の署名付きCDN URL群 */
		thumbnailImageUrls: {
			md: string; // 256x256
		}
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
