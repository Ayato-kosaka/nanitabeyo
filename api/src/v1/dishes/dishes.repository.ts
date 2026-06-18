// api/src/v1/dishes/dishes.repository.ts
//
// ❶ Prisma を使った DB アクセス層
// ❷ Service から呼ばれる具体的なクエリロジック
// ❸ トランザクション対応
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDishDto } from '@shared/v1/dto';
import { AppLoggerService } from 'src/core/logger/logger.service';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { google } from '@googlemaps/places/build/protos/protos';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';

export type ReusableGoogleImportDishMedia = {
  dishMediaId: string;
  reuseKind: 'completed' | 'google-import-non-completed';
};

@Injectable()
export class DishesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * レストランIDとカテゴリIDで料理を検索
   */
  async findDishByRestaurantAndCategory(
    restaurantId: string,
    categoryId: string,
  ) {
    return this.prisma.prisma.dishes.findFirst({
      where: {
        restaurant_id: restaurantId,
        category_id: categoryId,
      },
    });
  }

  /**
   * レストランを作成または取得（Google Place データから）
   */
  async createOrGetRestaurant(
    tx: Prisma.TransactionClient,
    restaurant: Prisma.restaurantsCreateInput,
    google_place_id: string,
  ) {
    this.logger.debug('createOrGetRestaurant', 'DishesRepository', restaurant);
    const { id: _omitId, ...createData } = restaurant;

    return await tx.restaurants.upsert({
      where: { google_place_id },
      update: {},
      create: createData,
    });
  }

  /**
   * カテゴリに基づいて料理を作成または取得
   */
  async createOrGetDishForCategory(
    tx: Prisma.TransactionClient,
    dish: {
      id?: string;
      restaurant_id: string;
      category_id: string;
      name: string | null;
      created_at?: Date;
      updated_at?: Date;
      lock_no?: number;
    },
  ) {
    const existing = await tx.dishes.findFirst({
      where: {
        restaurant_id: dish.restaurant_id,
        category_id: dish.category_id,
      },
    });

    if (existing) {
      return existing;
    }

    const { id: _omitId, ...createData } = dish;

    return tx.dishes.create({
      data: createData,
    });
  }

  /**
   * 料理メディアを作成（Google 写真から）
   */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dishMedia: PrismaDishMedia,
  ) {
    // #829 【バグ】未完了 Google import の再処理では同じ dish_media.id を再利用するため、retry で create すると主キー衝突する。
    return tx.dish_media.upsert({
      where: { id: dishMedia.id },
      update: {},
      create: dishMedia,
    });
  }

  /**
   * 料理レビューを作成（Google レビューから）
   */
  async createDishReviews(
    tx: Prisma.TransactionClient,
    reviews: PrismaDishReviews[],
  ) {
    // #829 【設計】既存 Google import の再処理では review payload も同じ ID になるため、Cloud Tasks retry は重複 insert ではなく no-op にする。
    return await tx.dish_reviews.createMany({
      data: reviews,
      skipDuplicates: true,
    });
  }

  /**
   * #829 【設計】Photo Media 前の再利用判定。
   *
   * 優先順位:
   * 1. completed は表示可能な既存 entry として返せるため、Photo Media と Cloud Task を両方 skip する。
   * 2. completed が無く Google import 由来(user_id=null)の未完了 media がある場合は、同じ ID を再処理対象にする。
   * 3. ユーザー投稿(user_id!=null)だけがある場合は、Google import の冪等性対象に巻き込まない。
   *
   * #829 【性能】dish_media は place/category join で大量取得せず、対象 dish_id 配下の代表 1 件だけを relation take で読む。
   * 将来 1 dish あたりの media が極端に増える場合は、schema への手書きコメントではなく migration で dish_media(dish_id, created_at) index を検討する。
   */
  async findReusableGoogleImportDishMediaByPlaceIdsAndCategory(
    placeIds: string[],
    categoryId: string,
  ): Promise<Map<string, ReusableGoogleImportDishMedia>> {
    if (placeIds.length === 0) return new Map();

    const dishes = await this.prisma.prisma.dishes.findMany({
      where: {
        category_id: categoryId,
        restaurants: {
          google_place_id: { in: placeIds },
        },
      },
      select: {
        id: true,
        restaurants: {
          select: { google_place_id: true },
        },
      },
    });
    if (dishes.length === 0) return new Map();

    const dishIds = dishes.map((dish) => dish.id);
    // #829 【性能】以降の media lookup は dish_id に閉じる。Text Search の place 数以上に探索範囲を広げない。
    const placeIdByDishId = new Map(
      dishes.map((dish) => [dish.id, dish.restaurants.google_place_id]),
    );

    // #829 【互換性】completed のみ、既存 assembler の URL でそのままフロントへ返せる。
    const dishesWithCompletedMedia = await this.prisma.prisma.dishes.findMany({
      where: { id: { in: dishIds } },
      select: {
        id: true,
        dish_media: {
          where: {
            media_processing_status: 'completed',
            thumbnail_processing_status: 'completed',
          },
          orderBy: { created_at: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    });

    const reusableMediaByPlaceId = new Map<
      string,
      ReusableGoogleImportDishMedia
    >();
    const dishIdsWithoutCompletedMedia: string[] = [];
    for (const dish of dishesWithCompletedMedia) {
      const placeId = placeIdByDishId.get(dish.id);
      const completedMedia = dish.dish_media[0];
      if (!placeId) continue;

      if (completedMedia) {
        reusableMediaByPlaceId.set(placeId, {
          dishMediaId: completedMedia.id,
          reuseKind: 'completed',
        });
      } else {
        dishIdsWithoutCompletedMedia.push(dish.id);
      }
    }

    if (dishIdsWithoutCompletedMedia.length === 0) {
      return reusableMediaByPlaceId;
    }

    // #829 【設計】未完了 media は Google import 由来だけ再利用する。ユーザー投稿は新規 Google import を妨げない。
    const dishesWithGoogleImportMedia =
      await this.prisma.prisma.dishes.findMany({
        where: { id: { in: dishIdsWithoutCompletedMedia } },
        select: {
          id: true,
          dish_media: {
            where: {
              user_id: null,
              OR: [
                { media_processing_status: { not: 'completed' } },
                { thumbnail_processing_status: { not: 'completed' } },
              ],
            },
            orderBy: { created_at: 'asc' },
            take: 1,
            select: { id: true },
          },
        },
      });

    for (const dish of dishesWithGoogleImportMedia) {
      const placeId = placeIdByDishId.get(dish.id);
      const googleImportMedia = dish.dish_media[0];
      if (!placeId || !googleImportMedia) continue;

      reusableMediaByPlaceId.set(placeId, {
        dishMediaId: googleImportMedia.id,
        reuseKind: 'google-import-non-completed',
      });
    }

    return reusableMediaByPlaceId;
  }

  /**
   * #829 【バグ】handler は place/category では止めない。
   *
   * bulk-import が新しい dish_media.id を返したあとに、同じ place/category の未完了 row だけを理由に return すると、
   * レスポンス ID が永続化されない。Cloud Tasks retry の冪等性境界は payload の dish_media.id と completed 状態に限定する。
   */
  async isDishMediaCompleted(dishMediaId: string): Promise<boolean> {
    const dishMedia = await this.prisma.prisma.dish_media.findUnique({
      where: { id: dishMediaId },
      select: {
        media_processing_status: true,
        thumbnail_processing_status: true,
      },
    });

    return (
      dishMedia?.media_processing_status === 'completed' &&
      dishMedia.thumbnail_processing_status === 'completed'
    );
  }
}
