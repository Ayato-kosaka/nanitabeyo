// api/src/v1/restaurants/nearby-restaurants-cte.ts
//
// #1666 「ユーザーの近くの店の候補集合」を作る CTE の正本。
//
// 【なぜ切り出すか】
// 店提案（`findDishMediaIds`）はこの候補集合を作ってからスコアリングする。
// #288 / #1666 の営業時間フィルタも **同じ候補集合**を対象に引かないと、
// `restaurant_opening_hours` を店の数だけ（620,000 店 × 曜日 2 日ぶん = 約 124 万行）
// 毎回の検索で引き上げることになる。クローラでテーブルが埋まった瞬間に効く時限爆弾で、
// 今は「テーブルが空だから軽い」だけである（#1666 の着手前提条件）。
//
// 同じ絞り込みを 2 箇所へ書き写すと必ずずれるので、**SQL 断片を 1 つにして両方が埋め込む**。
// 片方だけ書き戻すと `nearby-restaurants-cte.spec.ts` が落ちる。
//
// 【埋め込み先の前提】
// - 埋め込むと `knn_params` / `candidates_radius` / `nearby_restaurants` の 3 つの CTE が生える。
//   呼び出し側はこの名前を再定義しないこと
// - 消費するのは `nearby_restaurants(restaurant_id, rest_geog)`
// - `restaurants.location` の GIST 索引（`idx_restaurants_location`）に乗る書き方である。
//   `ST_DWithin` と KNN 演算子（`<->`）を外すと «索引には乗っているのに遅い» へ静かに戻る
//   （#1629 の実測: 半径 5km の東京駅で 9.3 秒）

import { Prisma } from '../../../../shared/prisma/client';

/**
 * KNN で先に絞る候補数。
 *
 * スコアリング前にここまで落とすので、後段（dishes / dish_media の JOIN、
 * 営業時間の引き上げ）の重さはすべてこの数で頭打ちになる。
 */
export function knnCandidateLimit(limit: number): number {
  return Math.max(1000, 50 * limit);
}

/**
 * ユーザー位置から半径内を GIST 索引で絞り、近い順に `knnCandidateLimit` 件だけ残す。
 *
 * ⚠️ 半径は «いま見えている viewport の外接円» なので、日本全体が映っていれば 1,400km 級になる。
 *    半径で絞るだけでは候補が減らないため、**KNN + LIMIT が実質の上限**である。
 */
export function nearbyRestaurantsCte(params: {
  userLat: number;
  userLon: number;
  radiusM: number;
  limit: number;
}): Prisma.Sql {
  const { userLat, userLon, radiusM, limit } = params;
  return Prisma.sql`
    knn_params AS (
      SELECT
        ST_SetSRID(
          ST_MakePoint(
            CAST(${userLon} AS double precision),
            CAST(${userLat} AS double precision)
          ),
          4326
        )::geography AS user_geog,
        CAST(${radiusM} AS double precision) AS radius_m,
        CAST(${knnCandidateLimit(limit)} AS integer) AS knn_limit
    ),
    candidates_radius AS (
      SELECT
        r.id AS restaurant_id,
        r.location AS rest_geog
      FROM restaurants r
      WHERE ST_DWithin(
              r.location,
              (SELECT user_geog FROM knn_params),
              (SELECT radius_m FROM knn_params)
            )
    ),
    nearby_restaurants AS (
      SELECT cr.restaurant_id, cr.rest_geog
      FROM candidates_radius cr
      ORDER BY cr.rest_geog <-> (SELECT user_geog FROM knn_params)  -- KNN
      LIMIT (SELECT knn_limit FROM knn_params)
    )
  `;
}
