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
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { AppLoggerService } from 'src/core/logger/logger.service';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { google } from '@googlemaps/places/build/protos/protos';

@Injectable()
export class DishesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) { }

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
   * 料理を作成
   */
  async createDish(dto: CreateDishDto) {
    return this.prisma.prisma.dishes.create({
      data: {
        restaurant_id: dto.restaurantId,
        category_id: dto.dishCategoryId,
        name: dto.dishName,
      },
    });
  }

  /**
   * レストランを作成または取得（Google Place データから）
   */
  async createOrGetRestaurant(
    tx: Prisma.TransactionClient,
    place: google.maps.places.v1.IPlace,
    placeImageUrl: string,
  ) {
    this.logger.debug('createOrGetRestaurant', 'DishesRepository', {
      googlePlaceId: place.id,
      name: place.name,
    });

    if (
      !place.id ||
      !place.name ||
      !place.location?.latitude ||
      !place.location?.longitude
    )
      throw new Error(`Invalid place data: ${JSON.stringify(place)}`);

    // PostGIS geography カラムを扱いつつ、
    // INSERT … ON CONFLICT DO NOTHING RETURNING *
    const rows = await tx.$queryRaw<PrismaRestaurants[]>(
      Prisma.sql`
        INSERT INTO restaurants
          (google_place_id, name, location, image_url, created_at)
        VALUES
          (
            ${place.id},
            ${place.name},
            ST_SetSRID(
              ST_MakePoint(${place.location.longitude}, ${place.location?.latitude}),
              4326
            ),
            ${placeImageUrl},
            NOW()
          )
        ON CONFLICT (google_place_id) DO NOTHING
        RETURNING *;
      `,
    );

    if (rows.length === 1) {
      // 新規挿入に成功
      return rows[0];
    }

    // Conflict で何も返らなかった場合は既存行を SELECT
    const existing = await tx.restaurants.findUnique({
      where: { google_place_id: place.id },
    });
    if (!existing) {
      // 理論的には起こらない
      throw new Error(
        `Failed to insert or find restaurant with place_id=${place.id}`,
      );
    }
    return existing;
  }

  /**
   * カテゴリに基づいて料理を作成または取得
   */
  async createOrGetDishForCategory(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    dishCategoryId: string,
    dishName: string,
  ) {
    const existing = await tx.dishes.findFirst({
      where: {
        restaurant_id: restaurantId,
        category_id: dishCategoryId,
      },
    });

    if (existing) {
      return existing;
    }

    return tx.dishes.create({
      data: {
        restaurant_id: restaurantId,
        category_id: dishCategoryId,
        name: dishName,
      },
    });
  }

  /**
   * 料理メディアを作成（Google 写真から）
   */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dishId: string,
    mediaPath: string,
  ) {
    return tx.dish_media.create({
      data: {
        dish_id: dishId,
        user_id: null, // Google からのインポートなので null
        media_path: mediaPath,
        media_type: 'image',
        thumbnail_path: mediaPath, // 同じパスを使用
      },
    });
  }

  /**
   * 料理レビューを作成（Google レビューから）
   */
  async createDishReview(
    tx: Prisma.TransactionClient,
    dishId: string,
    review: google.maps.places.v1.IReview,
  ) {
    const result = await tx.dish_reviews.create({
      data: {
        dish_id: dishId,
        user_id: null, // Google からのインポートなので null
        comment: review.text?.text || '',
        rating: review.rating || 0,
        price_cents: null,
        currency_code: null,
        created_dish_media_id: null,
        imported_user_name: review.authorAttribution?.displayName || null,
        imported_user_avatar: review.authorAttribution?.photoUri || null,
      },
    });

    return result as PrismaDishReviews;
  }
}
