// api/src/v1/users/users.repository.ts
//
// Repository for users data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaUsers } from '../../../../shared/converters/convert_users';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { Prisma } from '../../../../shared/prisma/client';
import { QueryMyDishesDto, MyDishStatus } from '@shared/v1/dto';
import { MY_DISH_MAP_PINS_LIMIT } from '@shared/v1/res';
import { roundToOneDecimal } from '../../core/utils/backend-utils';
import {
  MyDishCursor,
  buildMyDishMapPinsQuery,
  buildMyDishesOldestWantSaveQuery,
  buildMyDishesPageQuery,
} from './my-dishes.query';

/** #1395 一覧 1 行ぶんの生データ（DishMediaEntry の組み立ては Service 側で行う） */
export type MyDishRowEntity = {
  key: string;
  status: MyDishStatus;
  occurredAt: Date;
  savedAt: Date | null;
  eatenAt: Date | null;
  reviewId: string | null;
  /** 代表メディア（#1395 m-7 の規則で解決済み）。写真なし記録では null */
  mediaId: string | null;
  distanceMeters: number | null;
  restaurant: PrismaRestaurants;
  dish: PrismaDishes & {
    reviewCount: number;
    averageRating: number;
    /** #1398 PR1: `dish_categories.image_url`（NOT NULL）。写真なし行のフォールバック画像に使う */
    categoryImageUrl: string;
  };
  /** カーソル生成用（sort ごとに必要な要素だけ使う） */
  cursorSource: {
    row_key: string;
    occurred_at: Date;
    rating: number | null;
    distance_meters: number | null;
    feature_score: number | null;
  };
};

/** #1395 Map ピン 1 件ぶんの生データ */
export type MyDishPinEntity = {
  restaurant: PrismaRestaurants;
  counts: { want: number; eaten: number };
  latestOccurredAt: Date;
  /** 代表メディアのサムネイル組み立てに必要な最小限の列 */
  representativeMedia: {
    id: string;
    thumbnail_path: string;
    thumbnail_processing_status: string;
  } | null;
};

type RestaurantColumns = {
  r_id: string;
  r_google_place_id: string;
  r_name: string;
  r_name_language_code: string;
  r_latitude: number;
  r_longitude: number;
  r_image_url: string;
  r_image_path: string | null;
  r_address_components: Prisma.JsonValue;
  r_plus_code: Prisma.JsonValue | null;
  r_created_at: Date;
};

type DishColumns = {
  d_id: string;
  d_restaurant_id: string;
  d_category_id: string;
  d_name: string | null;
  d_created_at: Date;
  d_updated_at: Date;
  d_lock_no: number;
  d_category_image_url: string;
};

type MyDishRawRow = RestaurantColumns &
  DishColumns & {
    row_key: string;
    row_status: MyDishStatus;
    review_id: string | null;
    dish_id: string;
    occurred_at: Date;
    saved_at: Date | null;
    rating: number | null;
    distance_meters: number | null;
    feature_score: number | null;
    media_id: string | null;
    review_count: number;
    average_rating: number;
  };

type MyDishPinRawRow = RestaurantColumns & {
  want_count: number;
  eaten_count: number;
  latest_occurred_at: Date;
  media_id: string | null;
  media_thumbnail_path: string | null;
  media_thumbnail_processing_status: string | null;
};

const toRestaurant = (row: RestaurantColumns): PrismaRestaurants => ({
  id: row.r_id,
  google_place_id: row.r_google_place_id,
  name: row.r_name,
  name_language_code: row.r_name_language_code,
  latitude: row.r_latitude,
  longitude: row.r_longitude,
  image_url: row.r_image_url,
  image_path: row.r_image_path,
  address_components: row.r_address_components,
  plus_code: row.r_plus_code,
  created_at: row.r_created_at,
});

@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ================================================================== */
  /*                       #1395 my-dishes                              */
  /* ================================================================== */
  //
  // SQL の組み立ては ./my-dishes.query.ts（PrismaService に依存しない純関数）に置き、
  // ここは実行と行のマッピングだけを持つ。Blocker だった keyset / LIMIT 押し込みを
  // DB 無しで単体テストできるようにするためである。

  /**
   * #1395 GET /v1/users/me/dishes の本体。
   *
   * `limit + 1` 件取って `hasMore` を判定する既存の作法に合わせる。
   * `dish.reviewCount` / `averageRating` と代表メディアのフォールバックは
   * **LIMIT を掛けた後のページ内 dish に限定した LATERAL** で取る（m-5）。
   * 候補集合全体への `GROUP BY` は B-2 と同じ事故になる。
   */
  async findMyDishes(
    userId: string,
    dto: QueryMyDishesDto,
    cursor: MyDishCursor | null,
  ): Promise<{ items: MyDishRowEntity[]; hasMore: boolean }> {
    const limit = dto.limit ?? 42;

    this.logger.debug('FindMyDishes', 'findMyDishes', {
      userId,
      sort: dto.sort ?? '-occurredAt',
      limit,
      status: dto.status,
      hasCursor: cursor !== null,
    });

    const query = buildMyDishesPageQuery(userId, dto, cursor);
    if (!query) return { items: [], hasMore: false };

    const rows = await this.prisma.prisma.$queryRaw<MyDishRawRow[]>(query);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    this.logger.debug('FindMyDishesResult', 'findMyDishes', {
      count: page.length,
      hasMore,
    });

    return {
      items: page.map((row) => ({
        key: row.row_key,
        status: row.row_status,
        occurredAt: row.occurred_at,
        savedAt: row.saved_at,
        eatenAt: row.row_status === 'eaten' ? row.occurred_at : null,
        reviewId: row.review_id,
        mediaId: row.media_id,
        distanceMeters: row.distance_meters,
        restaurant: toRestaurant(row),
        dish: {
          id: row.d_id,
          restaurant_id: row.d_restaurant_id,
          category_id: row.d_category_id,
          name: row.d_name,
          created_at: row.d_created_at,
          updated_at: row.d_updated_at,
          lock_no: row.d_lock_no,
          reviewCount: row.review_count,
          averageRating: roundToOneDecimal(row.average_rating),
          categoryImageUrl: row.d_category_image_url,
        },
        cursorSource: {
          row_key: row.row_key,
          occurred_at: row.occurred_at,
          rating: row.rating,
          distance_meters: row.distance_meters,
          feature_score: row.feature_score,
        },
      })),
      hasMore,
    };
  }

  /**
   * #1395 GET /v1/users/me/dishes/map-pins の本体。
   *
   * Map は「viewport 内のピンを全部」欲しいのでページングしない。
   * 代わりに `MY_DISH_MAP_PINS_LIMIT` で打ち切り、**切られたことを呼び出し元へ返す**。
   * 黙って切らない。
   */
  async findMyDishMapPins(
    userId: string,
    dto: QueryMyDishesDto,
  ): Promise<{ items: MyDishPinEntity[]; truncated: boolean }> {
    this.logger.debug('FindMyDishMapPins', 'findMyDishMapPins', {
      userId,
      status: dto.status,
      hasArea: dto.lat !== undefined,
    });

    const query = buildMyDishMapPinsQuery(userId, dto);
    if (!query) return { items: [], truncated: false };

    const rows = await this.prisma.prisma.$queryRaw<MyDishPinRawRow[]>(query);

    const truncated = rows.length > MY_DISH_MAP_PINS_LIMIT;
    const pins = truncated ? rows.slice(0, MY_DISH_MAP_PINS_LIMIT) : rows;

    this.logger.debug('FindMyDishMapPinsResult', 'findMyDishMapPins', {
      count: pins.length,
      truncated,
    });

    return {
      items: pins.map((row) => ({
        restaurant: toRestaurant(row),
        counts: { want: row.want_count, eaten: row.eaten_count },
        latestOccurredAt: row.latest_occurred_at,
        representativeMedia:
          row.media_id && row.media_thumbnail_path
            ? {
                id: row.media_id,
                thumbnail_path: row.media_thumbnail_path,
                thumbnail_processing_status:
                  row.media_thumbnail_processing_status ?? 'idle',
              }
            : null,
      })),
      truncated,
    };
  }

  /**
   * #1395 Calendar が「どこまで遡れるか」を知るための最古 `occurredAt`。
   *
   * **`status` 以外のフィルタが無いときだけ**算出する。
   * その条件下では、両枝とも索引の先頭 1 行を読むだけで済む
   * （`idx_dish_reviews_user_created_at` / `idx_reactions_profile_cursor`）。
   * カテゴリ・エリア・評価・期間が付くと索引で順序を保てず、
   * `dish_reviews`（約 964MB）に対するユーザー全行走査が
   * **フィルタを変えるたびに** 1 回走ってしまうため、その場合は算出しない（B-2）。
   *
   * want 側だけは「もう食べた dish の save」を除くため `reactions` を 1 度舐める（m-b）。
   */
  async findMyDishesOldestOccurredAt(
    userId: string,
    statuses: MyDishStatus[],
  ): Promise<Date | null> {
    // eaten / want の 2 本は独立なので並列に引く（片方だけのときは 1 本）
    const [oldestReview, oldestSaveRows] = await Promise.all([
      statuses.includes('eaten')
        ? this.prisma.prisma.dish_reviews.findFirst({
            // #1513 一覧の eaten 枝と同じ条件で引く。削除済みを混ぜると
            // 「一覧に 1 件も無い月まで Calendar が遡れる」表示になる
            where: { user_id: userId, deleted_at: null },
            orderBy: { created_at: 'asc' },
            select: { created_at: true },
          })
        : Promise.resolve(null),
      // #1395 m-b / m-e: 一覧の want 行は「その dish に自分の dish_reviews が 1 件も無い」
      // ものだけ（NOT EXISTS）で、`occurredAt` は dish ごとの「最新 save」
      // （DISTINCT ON ... ORDER BY created_at DESC）。ここも dish ごとに畳んでから
      // MIN を取らないと、一覧に出ない月まで Calendar が遡れると表示してしまう。
      // SQL の形は my-dishes.query.ts（PrismaService に依存しない純関数）に置き、
      // DB 無しで単体テストできるようにしている。
      //
      // フェンスがあるので save 全件を 1 度読むが、この算出は
      // 「初回ページかつ status 以外のフィルタ無し」のときだけ走る（resolveOldestOccurredAt）。
      statuses.includes('want')
        ? this.prisma.prisma.$queryRaw<{ oldest: Date | null }[]>(
            buildMyDishesOldestWantSaveQuery(userId),
          )
        : Promise.resolve([] as { oldest: Date | null }[]),
    ]);

    const candidates: Date[] = [];
    if (oldestReview) candidates.push(oldestReview.created_at);
    const oldestSave = oldestSaveRows[0]?.oldest ?? null;
    if (oldestSave) candidates.push(oldestSave);

    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a < b ? a : b));
  }

  /**
   * ユーザーの収益一覧を取得
   */
  async findUserPayouts(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.payouts.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
    this.logger.debug('FindUserPayouts', 'findUserPayouts', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.payouts.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('UserPayoutsFound', 'findUserPayouts', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * ユーザーの入札履歴を取得
   */
  async findUserRestaurantBids(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.restaurant_bids.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
    this.logger.debug('FindUserRestaurantBids', 'findUserRestaurantBids', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.restaurant_bids.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('UserRestaurantBidsFound', 'findUserRestaurantBids', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * 指定されたIDのユーザーを取得
   */
  async getUserByIds(userId: string[]) {
    return this.prisma.prisma.users.findMany({
      where: {
        id: { in: userId },
      },
    });
  }

  /**
   * 指定されたIDのユーザーを1件取得
   */
  async getUserById(userId: string) {
    return this.prisma.prisma.users.findUnique({
      where: { id: userId },
    });
  }

  /**
   * ユーザープロフィールを更新
   */
  async updateUserProfile(
    data: Partial<Omit<PrismaUsers, 'created_at' | 'updated_at' | 'lock_no'>>,
  ) {
    const result = await this.prisma.prisma.users.update({
      where: { id: data.id },
      data: {
        ...data,
        updated_at: new Date(),
        lock_no: { increment: 1 },
      },
    });
    return result;
  }

  /**
   * ブロック中の料理カテゴリを取得
   */
  async findBlockedDishCategories(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: string[]; // dish_categories IDs
    nextCursor: string | null;
  }> {
    this.logger.debug(
      'FindBlockedDishCategories',
      'findBlockedDishCategories',
      {
        userId,
        cursor,
        limit,
      },
    );

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_categories',
      action_type: 'block',
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
      select: {
        target_id: true,
        created_at: true,
      },
    });

    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug(
      'BlockedDishCategoriesFound',
      'findBlockedDishCategories',
      {
        count: items.length,
        hasMore,
      },
    );

    return { items: items.map((r) => r.target_id), nextCursor };
  }

  /**
   * 料理カテゴリのブロックを解除
   */
  async unblockDishCategory(
    userId: string,
    categoryId: string,
  ): Promise<boolean> {
    this.logger.debug('UnblockDishCategory', 'unblockDishCategory', {
      userId,
      categoryId,
    });

    const result = await this.prisma.prisma.reactions.deleteMany({
      where: {
        user_id: userId,
        target_type: 'dish_categories',
        target_id: categoryId,
        action_type: 'block',
      },
    });

    this.logger.debug('UnblockDishCategoryResult', 'unblockDishCategory', {
      count: result.count,
    });

    return result.count > 0;
  }
}
