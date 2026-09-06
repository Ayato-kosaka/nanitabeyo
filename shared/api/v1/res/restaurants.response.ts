import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { DishMediaEntry } from "./dish-media.response";
import { PaginatedResponse } from "./paginated-response";

/**
 * #1779 **落とすことが決まっている列。API のレスポンスへ載せない。**
 *
 * ここを `Omit` で先に外しておくと、列が実際に DB から落ちたあとも
 * この型は 1 文字も変わらない（存在しないキーの `Omit` は無害）。
 * 生成物である `SupabaseRestaurants` の増減に、契約側が振り回されなくなる。
 *
 * - `image_url` … Google の写真 URI をそのまま持つ列。Places ToS 3.2.3 で保持できない。
 *   店の画像は `image_path` 由来の `imageUrls` から取る（#1680 / #1902）
 * - `plus_code` … Open Location Code。読み手が 1 つも無く、#1780 で新規保存も止めた
 */
const DROPPED_RESTAURANT_COLUMNS = ["image_url", "plus_code"] as const;

type DroppedRestaurantColumns = (typeof DROPPED_RESTAURANT_COLUMNS)[number];

/**
 * #1779 落とす列を実際のオブジェクトから取り除く。
 *
 * 型を `Omit` にしただけでは **実行時には残る**（スプレッドは余剰プロパティ検査を
 * すり抜けるため）。レスポンスへ載せないことを保証するのはこの関数である。
 *
 * ⚠️ 列が DB から落ちたあとも、この関数は何も壊さない（無いキーの `delete` は no-op）。
 */
export const stripDroppedRestaurantColumns = <T extends object>(
	row: T,
): Omit<T, DroppedRestaurantColumns> => {
	const stripped = { ...row } as Record<string, unknown>;
	for (const column of DROPPED_RESTAURANT_COLUMNS) delete stripped[column];
	return stripped as Omit<T, DroppedRestaurantColumns>;
};

export type RestaurantsEntity = Omit<SupabaseRestaurants, DroppedRestaurantColumns> & {
	/** レストラン画像の署名付きCDN URL群（派生サイズ） */
	imageUrls?: {
		sm: string; // 64x64
		md: string; // 256x256
	};
};

/** GET /v1/restaurants/search のレスポンス型 */
export type QueryRestaurantsResponse = {
	restaurant: RestaurantsEntity;
	meta: { reviewCount: number; averageRating: number; totalCents: number; maxEndDate: string | null };
}[];

/** POST /v1/restaurants のレスポンス型 */
export type CreateRestaurantResponse = {
	restaurant: RestaurantsEntity;
	meta: { reviewCount: number; averageRating: number; totalCents: number; maxEndDate: string | null };
};

/**
 * POST /v1/restaurants/draft のレスポンス型
 *
 * #1671 確認ページへ出す **Google 由来の既定値**と、それを封じた署名トークン。
 * まだ何も保存していない（店は「この内容で登録」を押すまで作られない）。
 */
export type CreateRestaurantDraftResponse = {
	draft: {
		googlePlaceId: string;
		/** 現地の言語での表示名。確認ページの店名欄の初期値 */
		name: string;
		nameLanguageCode: string;
		latitude: number;
		longitude: number;
		/** Google の addressComponents。監査用にそのまま返す */
		addressComponents: unknown;
		/** addressComponents から組み立てた表示用住所。住所欄の初期値（ユーザーが直せる） */
		address: string;
		/** addressComponents から解決した ISO 3166-1 alpha-2。判定できなければ null */
		countryCode: string | null;
		/**
		 * 確認ページの «国» 欄に出す表示名（「日本」など）。**表示専用で保存しない。**
		 * ユーザーに `JP` とだけ見せても «確認» にならないため。取れなければ null
		 */
		countryName: string | null;
	};
	/**
	 * POST /v1/restaurants へそのまま渡すトークン。
	 * ⚠️ 中身は署名済みで、クライアントが作り替えると作成が 400 になる。
	 */
	draftToken: string;
};

/** POST /v1/restaurants/:id/bids/intents のレスポンス型 */
export type CreateRestaurantBidIntentResponse = { clientSecret: string };

/** GET /v1/restaurants/:id/dish-media のレスポンス型 */
export type QueryRestaurantDishMediaResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/restaurants/:id/restaurant-bids のレスポンス型 */
export type QueryRestaurantBidsResponse = SupabaseRestaurantBids[];

/** GET /v1/restaurants/by-google-place-id のレスポンス型 */
export type QueryRestaurantsByGooglePlaceIdResponse = RestaurantsEntity;

/** GET /v1/restaurants/:id のレスポンス型 */
export type GetRestaurantByIdResponse = {
	restaurant: RestaurantsEntity;
	meta: { reviewCount: number; averageRating: number; totalCents: number; maxEndDate: string | null };
};
