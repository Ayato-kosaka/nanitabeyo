import { SupabasePayouts } from "../../../converters/convert_payouts";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { SupabaseDishCategories } from "../../../converters/convert_dish_categories";
import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";
import { PaginatedResponse } from "./paginated-response";
import { DishMediaEntry } from "./dish-media.response";
import { SupabaseUsers } from "../../../converters/convert_users";
import { RestaurantsEntity } from "./restaurants.response";
import { MyDishStatus } from "../dto/users/query-my-dishes.dto";
import { MeDishCategoryGroupVoteListItem } from "./dish-category-group-votes.response";

/**
 * ユーザープロフィール情報
 */
export type UserProfile = SupabaseUsers & {
	avatarUrls?: {
		sm: string; // 64x64
		md: string; // 256x256
	};
};

/** GET /v1/users/:id/dish-reviews のレスポンス型 */
export type QueryUserDishReviewsResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/users/me/liked-dish-media のレスポンス型 */
export type QueryMeLikedDishMediaResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/users/me/payouts のレスポンス型 */
export type QueryMePayoutsResponse = PaginatedResponse<SupabasePayouts>;

/** GET /v1/users/me/restaurant-bids のレスポンス型 */
export type QueryMeRestaurantBidsResponse = PaginatedResponse<SupabaseRestaurantBids>;

/** GET /v1/users/me/saved-dish-categories のレスポンス型 */
export type QueryMeSavedDishCategoriesResponse = PaginatedResponse<SupabaseDishCategories>;

/** GET /v1/users/me/blocked-dish-categories のレスポンス型 */
export type QueryMeBlockedDishCategoriesResponse = PaginatedResponse<SupabaseDishCategories>;

/** GET /v1/users/me/saved-dish-media のレスポンス型 */
export type QueryMeSavedDishMediaResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/users/me/dish-category-group-votes のレスポンス型 */
export type QueryMeDishCategoryGroupVotesResponse = PaginatedResponse<MeDishCategoryGroupVoteListItem>;

/** GET /v1/users/me/saved-restaurants のレスポンス型 */
export type QueryMeSavedRestaurantsResponse = PaginatedResponse<{
	restaurant: RestaurantsEntity;
	meta: {
		reviewCount: number;
		averageRating: number;
		lastSavedAt: string | null;
	};
}>;

export type { MyDishStatus };

/**
 * #1395 my-dishes の 1 行。
 *
 * 行の単位:
 * - 「食べた」行 = `dish_reviews` 1 件（`key = "review:<uuid>"`）。
 *   `dish_reviews` に `(dish_id, user_id)` の一意制約が無いため、同じ料理の再訪は別行として出る。
 * - 「食べたい」行 = dish 1 件（`key = "dish:<uuid>"`）。同じ dish の複数メディアを save していても
 *   1 行に畳む（`savedAt` は `MAX(reactions.created_at)`、期間で切らない表示用の値）。
 *   **その dish に自分の `dish_reviews` が 1 件でもあれば want 行は出さない**（状態の導出）。
 */
export type MyDishItem = {
	/** `"review:<uuid>"` | `"dish:<uuid>"`。カーソルの tiebreaker と React の key を兼ねる */
	key: string;
	status: MyDishStatus;
	/**
	 * 並び替え・Calendar のバケット用に正規化した日時。eaten なら `eatenAt`、want なら基本 `savedAt` と一致するが、
	 * `to` 指定時の want 行は「期間内の最新 save」になるため `savedAt`（期間で切らない）と食い違うことがある。
	 * `occurredAt === savedAt` を前提にしないこと。
	 */
	occurredAt: string;
	/** 食べたい登録日。食べた状態でも保持する（save reaction を消さないため） */
	savedAt: string | null;
	/** 食べた日（= `dish_reviews.created_at`）。want 行では null */
	eatenAt: string | null;

	restaurant: RestaurantsEntity;
	dish: SupabaseDishes & {
		/** ページ内の dish に限定した LATERAL で取る（候補集合全体の GROUP BY はしない）*/
		reviewCount: number;
		averageRating: number;
		/**
		 * `dish_categories.image_url`（NOT NULL）。#1398 PR1 で追加。
		 *
		 * `dishMedia === null`（写真なしの記録）のとき、クライアントは灰色プレースホルダーではなく
		 * `categoryImageUrl` → （それも無ければ）`restaurant.image_url` の順で実画像を表示すること
		 * （#1375 追補2 決定3）。表示側の実装は PR5 のスコープで、この PR は契約を通すだけ。
		 */
		categoryImageUrl: string;
		/**
		 * #1375 `dish_categories.labels`（言語コード → 表記）。取れなければ null。
		 *
		 * 表示名に `name`（= その店でのその料理の呼び名）だけを使うと、SNS 取り込み由来の
		 * 記録が «udon» のようにローマ字で出る（オーナー実機指摘）。
		 * クライアントは **`labels[言語] → labels["en"] → name`** の順で解決すること
		 * （`app-expo/features/myDishes/dishCategoryLabel.ts`）。
		 */
		categoryLabels: Record<string, string> | null;
	};

	/**
	 * 代表メディア。**選び方は固定する**（ページを取り直すたびに画像が変わらないようにするため。#1395 m-7）
	 * - want : 最新の save 対象メディア（`reactions.created_at` が最大のもの。同時刻は `dish_media.id` 降順）
	 * - eaten: `created_dish_media_id`。NULL ならその dish の最新メディア、それも無ければ null
	 *
	 * null のときはプレースホルダー表示にすること（写真なしの「食べた」記録）。
	 *
	 * ⚠️ #1513 `created_dish_media_id` が**削除済みメディアを指している**ときも null になる。
	 * その場合は `isOwnMediaDeleted === true` で、別の写真へ差し替えてはいけない
	 * （自分の食べた記録の写真が勝手に別人の写真になるため）。墓標を出すこと。
	 */
	dishMedia: DishMediaEntry["dish_media"] | null;

	/**
	 * #1513 自分の投稿（`myReview.created_dish_media_id` が指すメディア）が削除済みか。
	 *
	 * true のとき `dishMedia` は必ず null になる。行自体は残すので、クライアントは
	 * 「この投稿は削除されました」の墓標を出す（黙って消さない）。
	 *
	 * 墓標を出す画面 / 黙って除外する画面の切り分け（#1513 オーナー確定）:
	 * - **墓標を出す（行は残す）**: いいね一覧 / 保存一覧 / 通知 / レビューのサムネイル / my-dishes
	 * - **黙って除外する（行ごと消す）**: 検索結果 / 店舗フィード / 投票候補
	 */
	isOwnMediaDeleted: boolean;

	/**
	 * eaten のときの自分のレビュー（★n はここから引く）。want 行では null。
	 *
	 * ⚠️ `created_dish_media_id` を **`string | null` へ上書きしている**（#1395 レビュー m-d）。
	 * 20260819T0000 で `dish_reviews.created_dish_media_id` の NOT NULL を解除した
	 * （写真なしの「食べた」記録を許すため）が、`SupabaseDishReviews` は
	 * `prisma db pull` の生成物から作られており、**`pnpm db:pull` を回すまで
	 * `created_dish_media_id: string`（non-null）のまま**である。
	 * そのまま埋めるとクライアントには「必ず値がある」という嘘の契約が見え、
	 * `String(review.created_dish_media_id)` が `"null"` を作る事故を招く
	 * （`useDishMediaEntriesStore.ts` で実際に 1 度起きた形）。
	 *
	 * **`pnpm db:pull` を commit したら、この `Omit` を外して素の
	 * `SupabaseDishReviews` に戻すこと。** 生成物側が `string | null` になるため、
	 * この上書きは不要になる（残っていても同じ型だが、二重管理になる）。
	 */
	myReview:
		| (Omit<SupabaseDishReviews, "created_dish_media_id"> & {
				/** 写真なしの「食べた」記録では null（20260819T0000 で NOT NULL 解除済み） */
				created_dish_media_id: string | null;
				username: string;
				isLiked: boolean;
				likeCount: number;
		  })
		| null;

	/** `lat` / `lng` 指定時のみ。未指定なら null */
	distanceMeters: number | null;
};

/** GET /v1/users/me/dishes のレスポンス型 */
export type QueryMyDishesResponse = PaginatedResponse<MyDishItem> & {
	meta: {
		/**
		 * Calendar が「どこまで遡れるか」を知るための最古の `occurredAt`。
		 *
		 * **算出するのは「初回ページ（cursor 未指定）かつ status 以外のフィルタが無い」ときだけ**で、
		 * それ以外は null を返す。フィルタが付くと最古日時の算出は
		 * `dish_reviews`（約 964MB）に対するユーザー全行走査になり、
		 * フィルタを変えるたびに 1 回走ってしまうためである（#1395 B-2）。
		 * null のときクライアントは `nextCursor === null` による終端検出のみに頼ること。
		 */
		oldestOccurredAt: string | null;
	};
};

/** #1395 Map ビューの店舗ピン。同一店舗につき 1 つ（#1375 §3） */
export type MyDishPin = {
	restaurant: RestaurantsEntity;
	/** この店舗に紐づく行数の内訳 */
	counts: { want: number; eaten: number };
	/** この店舗で最も新しい行の `occurredAt` */
	latestOccurredAt: string;
	/** 最新行の代表メディアのサムネイル。写真なし記録しかなければ null */
	representativeThumbnailUrl: string | null;
	/**
	 * #1513 最新行の自分の投稿が削除済みか。true のとき
	 * `representativeThumbnailUrl` は null になる（別の写真へ差し替えない）。
	 * ピン自体は残すので、クライアントは墓標のサムネイルを出す。
	 */
	isOwnMediaDeleted: boolean;
};

/** #1395 Map ピンの上限。超えた分は返さず `truncated: true` で明示する（黙って切らない） */
export const MY_DISH_MAP_PINS_LIMIT = 300;

/** GET /v1/users/me/dishes/map-pins のレスポンス型 */
export type QueryMeDishMapPinsResponse = {
	data: MyDishPin[];
	/** 上限（`MY_DISH_MAP_PINS_LIMIT`）で切られたか。true ならクライアントは「絞り込んでください」を出す */
	truncated: boolean;
};

/** GET /v1/users/:id のレスポンス型 */
export type GetUserProfileResponse = UserProfile;

/** POST /v1/users/me のレスポンス型 */
export type UpdateUserProfileResponse = UserProfile;

/**
 * DELETE /v1/users/me のレスポンス型（#1511 ACC-01 アカウント削除）
 *
 * `deletedAt` は users.deleted_at に立てた時刻（ISO8601）。
 * 削除は取り消せないため「予約した時刻」ではなく「実行した時刻」である。
 */
export type DeleteMeResponse = {
	success: boolean;
	deletedAt: string;
};

/** DELETE /v1/users/me/blocked-dish-categories/:categoryId のレスポンス型 */
export type UnblockDishCategoryResponse = {
	success: boolean;
	message: string;
};
