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

/**
 * #1273 §40 / #1395 メディアの実体をどこから描画するか
 * - 'stored'        : 自ストレージ（`media_path` 必須）。従来の投稿はすべてこれ
 * - 'external_embed': SNS の公式埋め込み。`media_path` は NULL で `mediaUrl` も null になる。
 *                     表示は `externalEmbed.canonicalUrl` から provider 別コンポーネントが行う
 */
export type DishMediaRenderType = "stored" | "external_embed";

/**
 * #1273 §14 埋め込み元 SNS。
 *
 * #1395 の仕様追補で SNS import の対象は **TikTok / YouTube Shorts / Instagram の 3 つ**に
 * 確定した（X・threads は対象外）。DB 側も `dmee_provider_check` で同じ 3 値に制限している。
 */
export type ExternalEmbedProvider = "instagram" | "tiktok" | "youtube";

/** #1273 §39 埋め込みの死活 */
export type ExternalEmbedStatus = "unknown" | "available" | "unavailable";

/** #1395 `render_type='external_embed'` の dish_media が指す外部投稿 */
export type DishMediaExternalEmbed = {
	provider: ExternalEmbedProvider;
	externalContentId: string;
	canonicalUrl: string;
	embedStatus: ExternalEmbedStatus;
	lastVerifiedAt: string | null;
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
		/**
		 * #1395 `render_type='external_embed'` のときの埋め込み情報。
		 * 既存の組み立て箇所を壊さないため optional。未取得・stored のときは undefined か null。
		 *
		 * ⚠️ **現状どの経路もこの値を詰めていない。**
		 * `dish_media_external_embeddings` に行を作るのは SNS import（#1399）であり、
		 * 本 Issue の範囲はスキーマと契約の確定まで。読み取り経路への join は
		 * 書き込み側が入るのと同じ PR で足すこと（今入れると、行が 0 件のテーブルへの
		 * join を全読み取り経路に増やすだけになる）。
		 */
		externalEmbed?: DishMediaExternalEmbed | null;
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
