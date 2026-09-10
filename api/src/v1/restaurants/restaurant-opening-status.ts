// api/src/v1/restaurants/restaurant-opening-status.ts
//
// #288 / #1666 `restaurant_opening_hours` / `restaurant_hours_exceptions` から
// 「**選んだ時間帯**にこの店は営業しているか」（3値: open / closed / unknown）を求める。
//
// 判定ロジック本体は `shared/utils/openingHours.ts` の純関数（resolveOpeningStatus）が
// 唯一の実装で、ここは Prisma から生データを取ってそこへ渡すだけの薄い層にしてある。
// 判定を2箇所に写経しないため、店提案側（dish-media の検索）・店舗詳細側のどちらから
// 呼ばれても、この関数を経由すれば同じ判定になる。

import { Prisma } from '../../../../shared/prisma/client';
import {
  deriveJstCalendarContext,
  resolveOpeningStatus,
  type RestaurantHoursExceptionRow,
  type RestaurantOpeningHourRow,
  type RestaurantOpeningStatus,
} from '../../../../shared/utils/openingHours';
import {
  getTimeSlotWindow,
  type TimeSlot,
} from '../../../../shared/utils/timeSlot';
// #1666 引き上げる範囲は店提案の本体クエリと同じ候補集合に限る
import { nearbyRestaurantsCte } from './nearby-restaurants-cte';

/** Postgres の TIME（タイムゾーン無し）を Prisma が返す Date から「真夜中からの分」へ変換する */
function timeToMinutes(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

/** Postgres の DATE を Prisma が返す Date から YYYY-MM-DD へ変換する */
function dateToYmd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * 引き上げる範囲。**「ユーザーの近くの候補集合」以外を対象にしてはいけない。**
 *
 * #1666 これが無かったとき、`restaurant_opening_hours` を **曜日でしか絞っていなかった**。
 * 営業時間データを持つ店が少ないうちは軽いが、クローラでテーブルが埋まると
 * 620,000 店 × 曜日 2 日ぶん ≒ **124 万行を検索 1 回ごとに引き上げる**。
 * 「今は空だから速い」だけの時限爆弾だったので、着手前提条件として先に塞いだ。
 */
export type OpeningStatusScope = {
  userLat: number;
  userLon: number;
  radiusM: number;
  /** 店提案の返却件数。KNN で残す候補数（`knnCandidateLimit`）の入力になる */
  limit: number;
};

/**
 * `restaurant_opening_hours` / `restaurant_hours_exceptions` にデータが **ある** レストランだけを
 * 対象に、`timeSlot` の窓と重なるかで3値の営業状態を計算して返す。データが無い店
 * （現状はほぼ全店。#1666 のクローラは別 PR）は戻り値の Map に含まれない。呼び出し側は
 * `.get(restaurantId) ?? 'unknown'` として扱うこと。
 *
 * ⚠️ **引き上げる範囲は `scope` の候補集合に限る。** 絞り込みの定義は
 *    `nearby-restaurants-cte.ts` が正本で、店提案の本体クエリと**同じ断片**を埋め込んでいる。
 *    ここへ絞り込みを書き写すと、片方だけ変わったときに «本体は 1,000 店を見ているのに
 *    営業時間は 62 万店ぶん引く» という形でずれる。
 */
export async function fetchRestaurantOpeningStatuses(
  tx: Prisma.TransactionClient,
  timeSlot: TimeSlot,
  scope: OpeningStatusScope,
  now: Date = new Date(),
): Promise<Map<string, RestaurantOpeningStatus>> {
  const context = deriveJstCalendarContext(now, getTimeSlotWindow(timeSlot));
  const candidates = nearbyRestaurantsCte(scope);

  const [hoursRows, exceptionRows] = await Promise.all([
    tx.$queryRaw<
      {
        restaurant_id: string;
        source: string;
        day_of_week: number;
        opens_at: Date;
        closes_at: Date;
        crosses_midnight: boolean;
      }[]
    >(Prisma.sql`
      WITH ${candidates}
      SELECT
        roh.restaurant_id,
        roh.source,
        roh.day_of_week,
        roh.opens_at,
        roh.closes_at,
        roh.crosses_midnight
      FROM restaurant_opening_hours roh
      JOIN nearby_restaurants nr ON nr.restaurant_id = roh.restaurant_id
      WHERE roh.day_of_week IN (${Prisma.join([
        context.todayDayOfWeek,
        context.yesterdayDayOfWeek,
      ])});
    `),
    tx.$queryRaw<
      {
        restaurant_id: string;
        source: string;
        exception_date: Date;
        is_closed: boolean;
        opens_at: Date | null;
        closes_at: Date | null;
      }[]
    >(Prisma.sql`
      WITH ${candidates}
      SELECT
        rhe.restaurant_id,
        rhe.source,
        rhe.exception_date,
        rhe.is_closed,
        rhe.opens_at,
        rhe.closes_at
      FROM restaurant_hours_exceptions rhe
      JOIN nearby_restaurants nr ON nr.restaurant_id = rhe.restaurant_id
      WHERE rhe.exception_date IN (${Prisma.join([
        Prisma.sql`${context.todayDate}::date`,
        Prisma.sql`${context.yesterdayDate}::date`,
      ])});
    `),
  ]);

  const hoursByRestaurant = new Map<string, RestaurantOpeningHourRow[]>();
  for (const row of hoursRows) {
    const list = hoursByRestaurant.get(row.restaurant_id) ?? [];
    list.push({
      source: row.source,
      dayOfWeek: row.day_of_week,
      opensAtMinutes: timeToMinutes(row.opens_at),
      closesAtMinutes: timeToMinutes(row.closes_at),
      crossesMidnight: row.crosses_midnight,
    });
    hoursByRestaurant.set(row.restaurant_id, list);
  }

  const exceptionsByRestaurant = new Map<
    string,
    RestaurantHoursExceptionRow[]
  >();
  for (const row of exceptionRows) {
    const list = exceptionsByRestaurant.get(row.restaurant_id) ?? [];
    list.push({
      source: row.source,
      exceptionDate: dateToYmd(row.exception_date),
      isClosed: row.is_closed,
      opensAtMinutes: row.opens_at ? timeToMinutes(row.opens_at) : null,
      closesAtMinutes: row.closes_at ? timeToMinutes(row.closes_at) : null,
    });
    exceptionsByRestaurant.set(row.restaurant_id, list);
  }

  const restaurantIds = new Set<string>([
    ...hoursByRestaurant.keys(),
    ...exceptionsByRestaurant.keys(),
  ]);

  const statuses = new Map<string, RestaurantOpeningStatus>();
  for (const restaurantId of restaurantIds) {
    statuses.set(
      restaurantId,
      resolveOpeningStatus({
        hours: hoursByRestaurant.get(restaurantId) ?? [],
        exceptions: exceptionsByRestaurant.get(restaurantId) ?? [],
        context,
      }),
    );
  }
  return statuses;
}
