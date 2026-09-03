// api/src/v1/restaurants/restaurant-opening-status.ts
//
// #1666 `restaurant_opening_hours` / `restaurant_hours_exceptions` から
// 「今この店は開いているか」（3値: open / closed / unknown）を求める。
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

/** Postgres の TIME（タイムゾーン無し）を Prisma が返す Date から「真夜中からの分」へ変換する */
function timeToMinutes(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

/** Postgres の DATE を Prisma が返す Date から YYYY-MM-DD へ変換する */
function dateToYmd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * `restaurant_opening_hours` / `restaurant_hours_exceptions` にデータが **ある** レストランだけを
 * 対象に、3値の営業状態を計算して返す。データが無い店（現状は全店。#1666 のクローラは別 PR）は
 * 戻り値の Map に含まれない。呼び出し側は `.get(restaurantId) ?? 'unknown'` として扱うこと。
 *
 * データが無い店の全件走査を避けるため、`restaurant_opening_hours` /
 * `restaurant_hours_exceptions`（この2テーブル自体、当面は coverage が低く小さい）を起点に取得する。
 * 将来 coverage が上がってこれらのテーブルが育ったら、店舗候補を先に絞り込んでから
 * IN 句で引く形（例えば dish-media 側の候補 restaurant_id 集合を渡す）へ変える必要がある。
 */
export async function fetchRestaurantOpeningStatuses(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<Map<string, RestaurantOpeningStatus>> {
  const context = deriveJstCalendarContext(now);
  const todayDateUtc = new Date(`${context.todayDate}T00:00:00.000Z`);
  const yesterdayDateUtc = new Date(`${context.yesterdayDate}T00:00:00.000Z`);

  const [hoursRows, exceptionRows] = await Promise.all([
    tx.restaurant_opening_hours.findMany({
      where: {
        day_of_week: {
          in: [context.todayDayOfWeek, context.yesterdayDayOfWeek],
        },
      },
      select: {
        restaurant_id: true,
        source: true,
        day_of_week: true,
        opens_at: true,
        closes_at: true,
        crosses_midnight: true,
      },
    }),
    tx.restaurant_hours_exceptions.findMany({
      where: {
        exception_date: { in: [todayDateUtc, yesterdayDateUtc] },
      },
      select: {
        restaurant_id: true,
        source: true,
        exception_date: true,
        is_closed: true,
        opens_at: true,
        closes_at: true,
      },
    }),
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
