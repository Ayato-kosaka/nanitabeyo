import type { MyDishItem } from "@shared/api/v1/res";

/**
 * #1398 (PR4/7) want 行から「食べたを記録」へ送るときの遷移先。
 *
 * **新しいルートは作らない。** 既存の `review-from-media` の呼び出し元が 1 つ増えるだけである
 * （設計 (1/2) §1(a)）。元メディアに紐付くので写真撮影は要らず、`ReviewForm` は
 * `prefilledMedia` モードで開く。叩く API は `POST /v1/dish-reviews` の 1 本だけ
 * （`POST /v1/dishes` も `POST /v1/dish-media` も通らない）。
 *
 * 純関数に切り出してあるのは、一覧のカードと Sheet の行という **2 つの呼び出し元で
 * パラメータが 1 文字でもズレないことをテストで固定する**ためである。
 *
 * `dishMedia === null` は `null` を返す。want 行の `dishMedia` は契約上必ず非 null なので
 * （#1395 m-7）ここに来るのは異常系だけだが、`dishMedia.id` を触る前に必ず絞る。
 */
export type MarkAsEatenRoute = {
	pathname: "/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]";
	params: { locale: string; restaurantId: string; dishMediaId: string };
};

export const buildMarkAsEatenRoute = (item: MyDishItem, locale: string): MarkAsEatenRoute | null => {
	if (item.dishMedia === null) return null;
	return {
		pathname: "/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
		params: {
			locale,
			restaurantId: item.restaurant.id,
			dishMediaId: String(item.dishMedia.id),
		},
	};
};
