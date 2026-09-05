import type { MyDishItem } from "@shared/api/v1/res";
import { firstNonEmptyUrl } from "@shared/utils/imageFallback";

/**
 * #1398 PR5 「食べた/食べたい」記録の代表サムネイル URL 解決（#1375 追補2 決定3）。
 *
 * `dishMedia === null`（写真なしの記録。#1395 で `dish_reviews.created_dish_media_id` の
 * NOT NULL を解除済み）でも**灰色プレースホルダーにしない**。
 * `dish.categoryImageUrl`（`dish_categories.image_url`。NOT NULL・#1398 PR1 でマージ済み）
 * → `restaurant.image_url` の順で実画像へフォールバックし、3 つとも無いときだけ null を返す
 * （呼び出し側はそのときだけ無地背景 / アイコンにしてよい）。
 *
 * list / calendar の 2 ビューがこの関数を共有する（#1398 PR5 で calendar.ts から切り出した。
 * Calendar 側の挙動は変えていない）。Map のピンは店舗単位で `dish` を持たないため対象外
 * （`representativeThumbnailUrl ?? restaurant.image_url` を `MyDishesMapView.tsx` 側で直接使う。
 * 設計書 (2/2) §5-2）。
 *
 * ## R5 の申し送り: 他人の写真が代表画像になることがある（#1395 m-7 で決め切った仕様）
 *
 * `dishes` は `restaurant_id × category_id` で一意なので、写真なしの「食べた」記録は
 * 既存 dish に相乗りする。結果として `categoryImageUrl` ではなく `dishMedia` 自体が
 * 埋まっているケースでも、それが**別ユーザーの投稿**であることがある
 * （サーバ側 `COALESCE(own_media_id, fb.id)` の fb 側）。これは意図した挙動であり、バグではない。
 */
/*
 * #1273 ⚠️ **`??` で繋がないこと。** `dish.categoryImageUrl`（`dish_categories.image_url`）も
 * `restaurant.image_url` も **NOT NULL で «無い» を空文字で表す**列である。`??` は空文字を
 * «見つかった» として通すので、カテゴリの絵が空の記録は `restaurant.image_url` へ落ちず、
 * 空文字が返って呼び出し側（`resolveMyDishThumbnail`）で `kind: "none"` の無地になっていた。
 * dev 実測（2026-09-05）で絵の無いカテゴリは 221 種類・usable の 2.15% にあたる。
 * 判定は `shared/utils/imageFallback.ts` に 1 本だけ置く。
 */
export const resolveMyDishThumbnailUrl = (item: MyDishItem): string | null =>
	firstNonEmptyUrl(item.dishMedia?.thumbnailImageUrl, item.dish?.categoryImageUrl, item.restaurant?.image_url);

/**
 * #1513 サムネイル枠に何を描くか。
 *
 * - `photo`: その URL の画像を描く
 * - `deleted`: **墓標**（`components/DeletedMediaTombstone.tsx`）。自分の投稿が削除済み
 * - `none`: 画像が 1 つも引けなかった異常系。従来どおりの無地プレースホルダー
 */
export type MyDishThumbnail = { kind: "photo"; url: string } | { kind: "deleted" } | { kind: "none" };

/**
 * #1513 【設計】`isOwnMediaDeleted` を **フォールバックより先に**見る。
 *
 * `isOwnMediaDeleted === true`（自分の投稿が削除済み）のとき、サーバーは `dishMedia` を
 * null にして返す。ここで `resolveMyDishThumbnailUrl` をそのまま呼ぶと
 * `categoryImageUrl` / `restaurant.image_url` へ落ちてしまい、**自分が消した写真の跡地に
 * 別の絵が入って「消えたこと」が伝わらない**（オーナー確定: 黙って差し替えない）。
 *
 * 分岐をこの 1 関数に置くのは、list / calendar / 地図ピンで判断がずれないようにするため。
 * 「黙って除外する」側の画面（検索結果 / 店舗フィード / 投票候補）はそもそも削除済みの行が
 * サーバーから返らないので、この関数を通らない。
 */
export const resolveMyDishThumbnail = (item: MyDishItem): MyDishThumbnail => {
	if (item.isOwnMediaDeleted) return { kind: "deleted" };
	const url = resolveMyDishThumbnailUrl(item);
	return url ? { kind: "photo", url } : { kind: "none" };
};
