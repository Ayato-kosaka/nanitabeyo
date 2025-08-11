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
    restaurant: PrismaRestaurants,
    google_place_id: string,
  ) {
    this.logger.debug('createOrGetRestaurant', 'DishesRepository', restaurant);
    await tx.restaurants.upsert({
      where: { google_place_id },
      update: {},
      create: {
        ...restaurant
      },
    });
    return restaurant;
  }

  /**
   * カテゴリに基づいて料理を作成または取得
   */
  async createOrGetDishForCategory(
    tx: Prisma.TransactionClient,
    dish: PrismaDishes,
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

    return tx.dishes.create({
      data: dish,
    });
  }

  /**
   * 料理メディアを作成（Google 写真から）
   */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dishMedia: PrismaDishMedia
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
}
