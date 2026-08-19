// api/src/v1/users/my-dishes.query.ts
//
// #1395 GET /v1/users/me/dishes・/map-pins が共有する
// 「keyset カーソルの符号化」と「keyset 述語 / 並び順の組み立て」。
//
// SQL 本体（users.repository.ts）から切り出しているのは、ここが本 Issue の
// Blocker 2 件（B-1: -rating の keyset / B-2: LIMIT の枝内押し込み）の核であり、
// DB 無しで単体テストできるようにしておきたいためである。

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import type { MyDishSort } from '@shared/v1/dto';

/**
 * 候補行（UNION ALL の各枝）が公開する列名。
 *
 * 枝の中身は `SELECT ... FROM ...` を素の副問い合わせで包み、
 * keyset 述語と ORDER BY は**この別名**に対して書く。
 * こうすると 2 枝で述語を共有でき、Postgres は副問い合わせを平坦化するので
 * 索引による早期打ち切りも保たれる。
 */
export const MY_DISH_ROW_COLUMNS = {
  key: 'row_key',
  status: 'row_status',
  occurredAt: 'occurred_at',
  rating: 'rating',
  distance: 'distance_meters',
  featureScore: 'feature_score',
} as const;

/** keyset カーソルの復元結果。sort ごとに構成要素が違う */
export type MyDishCursor =
  | { sort: '-occurredAt' | 'occurredAt'; occurredAt: Date; key: string }
  | {
      sort: '-rating';
      /**
       * #1395 B-1: **NULL 判定を第1ソートキーへ持ち上げる**。
       * `NULLS LAST` を書くだけでは 2 ページ目以降で want 行が全部消える
       * （`(rating, ...) < ($r, ...)` が rating IS NULL の行に対して unknown を返し、
       * WHERE が unknown を偽として扱うため）。
       */
      ratingIsNull: boolean;
      rating: number | null;
      occurredAt: Date;
      key: string;
    }
  | { sort: 'distance'; distanceMeters: number; key: string }
  | {
      sort: '-sceneScore' | '-timeSlotScore';
      score: number;
      occurredAt: Date;
      key: string;
    };

/** カーソルの区切り文字。`row_key`（`review:<uuid>` / `dish:<uuid>`）にも ISO8601 にも現れない */
const SEP = '|';

/** カーソル生成に必要な行の情報（SQL の返り値の部分集合） */
export type MyDishCursorSource = {
  row_key: string;
  occurred_at: Date;
  rating: number | null;
  distance_meters: number | null;
  feature_score: number | null;
};

/**
 * 次ページ用カーソルを組み立てる。
 *
 * ⚠️ テンプレートリテラルで `null` を文字列化しないこと（`"null"` になり `Number("null")` が NaN になる）。
 * NULL は**空文字 + 別立ての NULL フラグ**で表す。
 */
export function encodeMyDishCursor(
  sort: MyDishSort,
  row: MyDishCursorSource,
): string {
  const iso = row.occurred_at.toISOString();
  switch (sort) {
    case '-occurredAt':
    case 'occurredAt':
      return [iso, row.row_key].join(SEP);
    case '-rating':
      return [
        row.rating === null ? '1' : '0',
        row.rating === null ? '' : String(row.rating),
        iso,
        row.row_key,
      ].join(SEP);
    case 'distance':
      if (row.distance_meters === null) {
        // distance ソートは lat/lng 必須なのでここには来ない。来たら契約違反なので落とす
        throw new Error('distance sort produced a row without distance_meters');
      }
      return [String(row.distance_meters), row.row_key].join(SEP);
    case '-sceneScore':
    case '-timeSlotScore':
      return [String(row.feature_score ?? 0), iso, row.row_key].join(SEP);
  }
}

function invalidCursor(): never {
  throw new BadRequestException('Invalid cursor');
}

function parseIsoDate(raw: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) invalidCursor();
  return d;
}

function parseFiniteNumber(raw: string): number {
  if (raw.trim() === '') invalidCursor();
  const n = Number(raw);
  if (!Number.isFinite(n)) invalidCursor();
  return n;
}

/**
 * カーソルを復元する。壊れていたら **400 で落とす**。
 * 黙って無視すると同じページを 2 回返してしまい、無限スクロールが重複する。
 */
export function decodeMyDishCursor(
  sort: MyDishSort,
  raw: string,
): MyDishCursor {
  const parts = raw.split(SEP);
  switch (sort) {
    case '-occurredAt':
    case 'occurredAt': {
      if (parts.length !== 2 || !parts[1]) invalidCursor();
      return { sort, occurredAt: parseIsoDate(parts[0]), key: parts[1] };
    }
    case '-rating': {
      if (parts.length !== 4 || !parts[3]) invalidCursor();
      const [flag, ratingRaw, isoRaw, key] = parts;
      if (flag !== '0' && flag !== '1') invalidCursor();
      const ratingIsNull = flag === '1';
      if (ratingIsNull && ratingRaw !== '') invalidCursor();
      if (!ratingIsNull && ratingRaw === '') invalidCursor();
      return {
        sort,
        ratingIsNull,
        rating: ratingIsNull ? null : parseFiniteNumber(ratingRaw),
        occurredAt: parseIsoDate(isoRaw),
        key,
      };
    }
    case 'distance': {
      if (parts.length !== 2 || !parts[1]) invalidCursor();
      return {
        sort,
        distanceMeters: parseFiniteNumber(parts[0]),
        key: parts[1],
      };
    }
    case '-sceneScore':
    case '-timeSlotScore': {
      if (parts.length !== 3 || !parts[2]) invalidCursor();
      return {
        sort,
        score: parseFiniteNumber(parts[0]),
        occurredAt: parseIsoDate(parts[1]),
        key: parts[2],
      };
    }
  }
}

/**
 * 並び順。UNION ALL の各枝の中でも、マージ後の外側でも**同じ式**を使う。
 *
 * `-rating` は `(rating IS NULL) ASC` を第1キーに置く。これにより
 * - 評価なし（= want）の行が★5より上に来ることがなくなり（Postgres の `DESC` 既定は `NULLS FIRST`）、
 * - **want 行は常に末尾**という仕様が表現できる。
 */
export function buildMyDishOrderBy(sort: MyDishSort): Prisma.Sql {
  switch (sort) {
    case '-occurredAt':
      return Prisma.sql`occurred_at DESC, row_key DESC`;
    case 'occurredAt':
      return Prisma.sql`occurred_at ASC, row_key ASC`;
    case '-rating':
      return Prisma.sql`(rating IS NULL) ASC, rating DESC, occurred_at DESC, row_key DESC`;
    case 'distance':
      return Prisma.sql`distance_meters ASC, row_key ASC`;
    case '-sceneScore':
    case '-timeSlotScore':
      return Prisma.sql`feature_score DESC, occurred_at DESC, row_key DESC`;
  }
}

/**
 * keyset 述語。カーソルが無ければ `TRUE`。
 *
 * **2 枝（want / eaten）で同じ述語を使う。** 枝ごとに書き分けないのは、
 * 書き分けた瞬間に「want 側で rating を落とす」類の取りこぼしが混入するためである。
 */
export function buildMyDishKeysetPredicate(
  cursor: MyDishCursor | null,
): Prisma.Sql {
  if (!cursor) return Prisma.sql`TRUE`;

  switch (cursor.sort) {
    case '-occurredAt':
      return Prisma.sql`(occurred_at, row_key) < (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)`;
    case 'occurredAt':
      return Prisma.sql`(occurred_at, row_key) > (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)`;
    case '-rating': {
      const cn = cursor.ratingIsNull ? 1 : 0;
      // n = 「評価が無い行か」の 0/1。並びは n ASC, rating DESC, occurred_at DESC, row_key DESC。
      //
      // - n > cn                       … 評価ありの区画を抜けて評価なし（want）区画へ入る
      // - n = cn かつ cn = 1           … want 区画の中。rating は全て NULL なので日時と key だけで進む
      // - n = cn かつ cn = 0           … eaten 区画の中。rating → 日時 → key の順で進む
      //
      // cn = 1 のとき ${cursor.rating} は NULL になるが、その枝は `1 = 0` で
      // 常に偽になる conjunct の中にあるため評価結果に影響しない（false AND NULL = false）。
      return Prisma.sql`(
        ((rating IS NULL)::int) > ${cn}::int
        OR (
          ((rating IS NULL)::int) = ${cn}::int
          AND ${cn}::int = 1
          AND (occurred_at, row_key) < (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)
        )
        OR (
          ((rating IS NULL)::int) = ${cn}::int
          AND ${cn}::int = 0
          AND (
            rating < ${cursor.rating}::int
            OR (
              rating = ${cursor.rating}::int
              AND (occurred_at, row_key) < (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)
            )
          )
        )
      )`;
    }
    case 'distance':
      return Prisma.sql`(distance_meters, row_key) > (${cursor.distanceMeters}::double precision, ${cursor.key}::text)`;
    case '-sceneScore':
    case '-timeSlotScore':
      return Prisma.sql`(
        feature_score < ${cursor.score}::double precision
        OR (
          feature_score = ${cursor.score}::double precision
          AND (occurred_at, row_key) < (${cursor.occurredAt}::timestamptz, ${cursor.key}::text)
        )
      )`;
  }
}

/**
 * この枝はカーソルより後ろの行を 1 件も持ち得ないか（= 枝ごと省略できるか）。
 *
 * `buildMyDishKeysetPredicate` だけでも結果は正しいが、`-rating` で
 * カーソルが want 区画に入った後は eaten 枝を投げても必ず 0 件なので、
 * `dish_reviews`（約 964MB）への問い合わせを 1 本まるごと省ける。
 *
 * ⚠️ **want 枝を省略できるケースは無い。**
 * `-rating` のカーソルが eaten 区画にあっても、want 行はまだ 1 件も返していない。
 * ここを「rating が無いから落とす」と書いた瞬間に B-1 の事故が再発する。
 */
export function isBranchSkippableByCursor(
  branch: 'want' | 'eaten',
  cursor: MyDishCursor | null,
): boolean {
  if (!cursor) return false;
  if (cursor.sort !== '-rating') return false;
  return branch === 'eaten' && cursor.ratingIsNull;
}

/**
 * 評価フィルタが指定されているか。
 *
 * #1395 m-4: want 行は評価を持たないため、評価フィルタが 1 つでも付いた瞬間に
 * want 行は 1 件も残らない。サーバ側は want 枝を評価せず eaten だけを返し、
 * クライアントは `status` に want を含む間、評価フィルタを不活性にすること。
 */
export function hasRatingFilter(dto: {
  minRating?: number;
  ratings?: number[];
}): boolean {
  return dto.minRating !== undefined || (dto.ratings?.length ?? 0) > 0;
}
