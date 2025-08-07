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
import { GoogleMapsPlace } from './google-maps.service';

@Injectable()
export class DishesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * レストランIDとカテゴリIDで料理を検索
   */
  async findDishByRestaurantAndCategory(
    restaurantId: string,
    categoryId: string,
  ) {
    return this.prisma.dishes.findFirst({
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
    return this.prisma.dishes.create({
      data: {
        restaurant_id: dto.restaurantId,
        category_id: dto.dishCategory,
        name: null, // Google API から取得した場合に設定
      },
    });
  }

  /**
   * レストランを作成または取得（Google Place データから）
   * 注意: 現在は地理的位置を保存せず、既存のレストランのみ検索
   */
  async createOrGetRestaurant(
    tx: Prisma.TransactionClient,
    place: GoogleMapsPlace,
  ) {
    // 既存レストランを place_id で検索
    let existing = await tx.restaurants.findFirst({
      where: {
        google_place_id: place.place_id,
      },
    });

    if (existing) {
      return existing;
    }

    // 名前で検索（place_idがない場合のフォールバック）
    existing = await tx.restaurants.findFirst({
      where: {
        name: place.name,
      },
    });

    if (existing) {
      return existing;
    }

    // TODO: 新規レストラン作成は geography 型の問題で一時的に無効化
    // 既存のレストランが見つからない場合は一時的なダミーデータを作成
    throw new Error(`Restaurant not found: ${place.name}. Please add restaurant manually first.`);
  }

  /**
   * カテゴリに基づいて料理を作成または取得
   */
  async createOrGetDishForCategory(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    categoryId: string,
  ) {
    const existing = await tx.dishes.findFirst({
      where: {
        restaurant_id: restaurantId,
        category_id: categoryId,
      },
    });

    if (existing) {
      return existing;
    }

    return tx.dishes.create({
      data: {
        restaurant_id: restaurantId,
        category_id: categoryId,
        name: null,
      },
    });
  }

  /**
   * 料理メディアを作成（Google 写真から）
   */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dishId: string,
    photoReference: string,
  ) {
    // Google Photo Reference を media_path として保存
    const mediaPath = `google_photos/${photoReference}`;
    
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
    review: any, // Google Maps Review 型
  ) {
    return tx.dish_reviews.create({
      data: {
        dish_id: dishId,
        user_id: null, // Google からのインポートなので null
        comment: review.text || '',
        rating: Math.round(review.rating), // Google は小数点、DBは整数
        price_cents: null,
        currency_code: null,
        created_dish_media_id: null,
        imported_user_name: review.author_name,
        imported_user_avatar: review.profile_photo_url,
      },
    });
  }
}