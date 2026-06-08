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
    return tx.dish_media.create({
      data: dishMedia,
    });
  }

  /**
   * 料理レビューを作成（Google レビューから）
   */
  async createDishReviews(
    tx: Prisma.TransactionClient,
    reviews: PrismaDishReviews[],
  ) {
    return await tx.dish_reviews.createMany({
      data: reviews,
    });
  }

  /**
   * #829 Google import の Photo Media 呼び出し前に、フロント改修なしで返せる既存メディアをまとめて探す。
   * ここで見つかった place は、外部 API 呼び出しも Cloud Task enqueue も不要になる。
   */
  async findCompletedDishMediaIdsByPlaceIdsAndCategory(
    placeIds: string[],
    categoryId: string,
  ): Promise<Map<string, string>> {
    if (placeIds.length === 0) return new Map();

    const dishMedias = await this.prisma.prisma.dish_media.findMany({
      where: {
        // #829 processing 画像は現行フロントが polling を継続しないため、bulk-import の既存返却は completed に限定する。
        media_processing_status: 'completed',
        thumbnail_processing_status: 'completed',
        dishes: {
          category_id: categoryId,
          restaurants: {
            google_place_id: { in: placeIds },
          },
        },
      },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        dishes: {
          select: {
            restaurants: {
              select: { google_place_id: true },
            },
          },
        },
      },
    });

    const firstMediaIdByPlaceId = new Map<string, string>();
    for (const dishMedia of dishMedias) {
      const placeId = dishMedia.dishes.restaurants.google_place_id;
      // #829 同じ place/category に複数 media がある場合も、新たな重複作成を避けるには代表 1 件で十分。
      if (!firstMediaIdByPlaceId.has(placeId)) {
        firstMediaIdByPlaceId.set(placeId, dishMedia.id);
      }
    }

    return firstMediaIdByPlaceId;
  }

  /**
   * #829 Cloud Task retry は Photo Media 取得後に再実行されるため、status を問わず既存作成を止める。
   */
  async existsDishMediaByPlaceIdAndCategory(
    placeId: string,
    categoryId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.prisma.dish_media.findFirst({
      where: {
        dishes: {
          category_id: categoryId,
          restaurants: {
            google_place_id: placeId,
          },
        },
      },
      select: { id: true },
    });

    return existing !== null;
  }
}
