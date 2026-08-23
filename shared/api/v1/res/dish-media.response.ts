import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";
import { RestaurantsEntity } from "./restaurants.response";

/**
 * #511 【設計】メディア加工ステータスの型定義
 * - 'idle': まだ何もしていない（将来用）
 * - 'processing': 加工中（リサイズ・トランスコードなど）
 * - 'completed': 加工完了（リサイズ or トランスコード済み）
 * - 'failed': 加工失敗（タイムアウト / 形式不正 / 内部エラー等）
 */
export type MediaProcessingStatus = "idle" | "processing" | "completed" | "failed";

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
		/**
		 * 投稿メディアの署名付きCDN URL（派生サイズ）
		 * - 動画の場合: media_processing_status が 'completed' 以外は null
		 * - 画像の場合: media_processing_status に応じてオリジナル or リサイズ済みパス
		 */
		mediaUrl: string | null;
		/** 投稿サムネイル画像の署名付きCDN URL（派生サイズ or オリジナル） */
		thumbnailImageUrl: string;
	};
	dish_reviews: (SupabaseDishReviews & {
		username: string;
		isLiked: boolean;
		likeCount: number;
		/**
		 * #1513 閲覧者自身が書いたレビューかどうか。編集・削除の導線を出す判定に使う。
		 *
		 * クライアント側で `user_id === 自分の id` を組み立てさせない。所有判定は
		 * サーバーが持つ（PATCH / DELETE の認可と同じ根拠で返す）ため、
		 * 画面が出す導線と実際に通る操作がズレない。
		 */
		isMine: boolean;
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
	/**
	 * #1222 保存できなかった場合は null。
	 *
	 * view は解析用テレメトリなので、参照先 dish_media / impression がまだ存在しない
	 * タイミング障害では 500 ではなく `stored: false` の成功系で返す。
	 */
	id: string | null;
	dish_media_id: string;
	impression_id: string | null;
	stored: boolean;
	analysis_applied: boolean;
};

/**
 * DELETE /v1/dish-media/:id のレスポンス型 (#1513)
 *
 * 「投稿」の削除単位は dish_media 1 件と、その dish_media と一緒に作られたレビュー
 * (dish_reviews.created_dish_media_id = :id) である。メディアが消える以上、
 * そのメディアを前提に書かれたレビューだけを残すことはできない。
 * 論理削除なので行は残るが、レスポンスには本文を載せない。
 */
export type DeleteDishMediaResponse = {
	/** 論理削除した dish_media.id */
	id: string;
	/** 論理削除日時 (ISO8601) */
	deletedAt: string;
	/** 巻き添えで論理削除した dish_reviews.id */
	deletedDishReviewIds: string[];
};
