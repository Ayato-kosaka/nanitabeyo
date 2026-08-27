import type { RestaurantsEntity } from "@shared/api/v1/res";

/**
 * #1629 «食べたを記録 → お店を選ぶ» の地図（`select-restaurant.tsx`）が
 * 地図へ何をどれだけ出すかを決める純ロジック。
 *
 * ## なぜ切り出すか
 *
 * 直す前の画面は、API が返したピンを **1 件 1 マーカーで全部** 置いていた。
 * View Marker はネイティブ側で 1 個ずつビットマップになるので、これは
 * 「このエリアで再検索」を押すたびに数十枚のビットマップを焼く作りである
 * （オーナー指摘「ピンが出てる数もめっちゃ多い」「再検索が重い」）。
 *
 * 大手の地図アプリはここで必ず 3 つをやっている。
 *   1. 画面の外のピンは作らない（間引き）
 *   2. 重なるピンは 1 つに畳む（クラスタ）
 *   3. 同時に描く数そのものに上限を置く
 * 実装は `features/map/clustering.ts` に共通化してあり、この画面固有の
 * «数字» と «見せ方の切り替え» だけをここに置く。数字はテストで固定する。
 */

/** 地図に置ける最小限の «お店ピン»（近傍検索の結果も保存済みの店も同じ形を持つ） */
export type RestaurantPin = { restaurant: RestaurantsEntity };

/**
 * 同時に描くマーカーの上限（畳んだあとの数）。
 *
 * my-dishes の地図は 60（`MAX_RENDERED_CLUSTERS`）だが、この画面のマーカーは
 * **写真の丸 + 店名 2 行**（`RestaurantLabelMarker`）で、1 枚あたりのビットマップが
 * 明確に大きい。24 は «画面が店名で埋まらない» 上限でもある（実機で 40 枚並べると
 * 文字同士が重なって、どれがどの店か読めなくなる）。
 */
export const MAX_PICKER_MARKERS = 24;

/**
 * 近傍店舗の取得件数（API へ渡す `limit`）。
 *
 * ⚠️ 直す前は `limit` を **渡していなかった**。サーバ既定の 20 件
 * （`restaurants.repository.ts` の `LIMIT ${dto.limit ?? 20}`）が効いていたので、
 * クライアント側の `slice(0, 40)` は一度も働いていない（＝ 上限が «無い» のと同じで、
 * サーバの既定値が変わればそのまま増える）。ここで明示して固定する。
 *
 * 描く上限（`MAX_PICKER_MARKERS`）より多く取るのは、**畳んでから上限を掛ける**ため。
 * 密集地では 40 件が 15 個の丸になるので、40 取って 24 描くのは矛盾しない。
 */
export const NEARBY_PIN_FETCH_LIMIT = 40;

/** 保存済み店舗の取得件数。従来値（20）を明示的に据え置く */
export const SAVED_PIN_FETCH_LIMIT = 20;

/**
 * 地図を動かしてから取得を投げるまでの待ち時間（ms）。
 *
 * ⚠️ 直す前は `onRegionChangeComplete` のたびに**即座に**投げていた。
 * この callback は «指を離すたび» だけでなく、慣性スクロールの停止・
 * `animateToRegion` の着地でも飛ぶので、地図を数回はじくだけで
 * 同じ endpoint へ数本のリクエストが並ぶ。応答は「追い越しを捨てる」だけで
 * **キャンセルしていなかった**ので、サーバ側の集計クエリは全部走り切っていた。
 */
export const PICKER_FETCH_DEBOUNCE_MS = 400;

/**
 * これより広い表示域では «店名つきのマーカー» を出さない（点にする）。
 *
 * 0.05 度 ≒ 5.5km 四方。これより引くと、店名のラベルは互いに重なって読めなくなり、
 * ビットマップだけが増える。大手の地図アプリが引きで «点»、寄りで «名前つき» に
 * 切り替えているのと同じ考え方。
 */
export const LABEL_ZOOM_MAX_DELTA = 0.05;

/** マーカーの詳しさ。`label` = 写真 + 店名、`dot` = 点だけ */
export type PinDetailLevel = "label" | "dot";

export function pinDetailLevelForRegion(
	region: { latitudeDelta: number; longitudeDelta: number } | null,
): PinDetailLevel {
	if (!region) return "label";
	const delta = Math.max(region.latitudeDelta, region.longitudeDelta);
	if (!(delta > 0)) return "label";
	return delta > LABEL_ZOOM_MAX_DELTA ? "dot" : "label";
}

/**
 * 表示域から検索半径（m）を決める。
 *
 * #1629 【修正】の経緯: 日本全体が映っている状態（位置情報を拒否したときの初期表示）で
 * 「このエリアで再検索」を押すと latitudeDelta が 20 度前後になり、**半径 1,000 km** を
 * 投げていた。サーバ側の DTO は radius に上限を持たない（`@IsPositive` のみ）ので素通りし、
 * 全国の店舗を集計しようとして「保存したお店の取得に失敗しました」に落ちる。
 * 50 km は my-dishes の絞り込み（`QueryMyDishesDto.radius` の `@Max`）と同じ上限。
 * ⚠️ ここを外すなら、サーバ側にも上限を入れてからにすること。
 *
 * 係数 50000 は «delta 1 度 ≒ 111km» の半分（＝ 表示域の縦半分）にほぼ等しい。
 * つまり «画面に映っている範囲の内接円» を投げていることになる。
 *
 * #1629 【追加】**下限も置く。** 拡大しきると delta が 0.001 度を切り、半径 50m の
 * 検索になって «画面には店があるのに 1 件も返らない» が起きる。200m を下限にする。
 */
export const MIN_SEARCH_RADIUS_M = 200;
export const MAX_SEARCH_RADIUS_M = 50000;

export function radiusForRegion(region: { latitudeDelta: number; longitudeDelta: number }): number {
	const delta = Math.max(region.latitudeDelta, region.longitudeDelta);
	const raw = (Number.isFinite(delta) ? delta : 0) * 50000;
	return Math.min(Math.max(raw, MIN_SEARCH_RADIUS_M), MAX_SEARCH_RADIUS_M);
}
