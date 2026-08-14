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

export type ExternalDishMediaEmbed = {
	/**
	 * #1273 youtube を追加（migration 20260814T0000）。
	 * ①で確立した無料の発見手法は YouTube 由来で、実測でも embeddable 98.8% / 生存率100% と
	 * 4プロバイダの中で埋め込みの土台が最も健全。
	 */
	provider: "instagram" | "tiktok" | "x" | "youtube";
	externalContentId: string;
	canonicalUrl: string;
	embedHtml: string;
	thumbnailUrl: string | null;
	publishedAt: string | null;
	lastVerifiedAt: string;
};

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
		/** GCS媒体か、provider公式embedかをクライアントが明示的に分岐する。 */
		renderType: "stored_media" | "external_embed";
		/** renderType=external_embedのときだけ存在する。 */
		externalEmbed: ExternalDishMediaEmbed | null;
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
