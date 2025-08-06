// api/src/v1/dishes/dishes.service.ts
//
// Service for dishes operations

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import {
  CreateDishDto,
  BulkImportDishesDto,
} from '@shared/v1/dto';

import { DishesRepository } from './dishes.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalApiService } from '../../core/external-api/external-api.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class DishesService {
  constructor(
    private readonly repo: DishesRepository,
    private readonly prisma: PrismaService,
    private readonly externalApi: ExternalApiService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/dishes                               */
  /* ------------------------------------------------------------------ */
  async createDish(dto: CreateDishDto) {
    this.logger.debug('CreateDish', 'createDish', {
      restaurantId: dto.restaurantId,
      dishCategory: dto.dishCategory,
    });

    // レストランが存在するか確認
    const restaurantExists = await this.repo.restaurantExists(dto.restaurantId);
    if (!restaurantExists) {
      this.logger.warn('RestaurantNotFound', 'createDish', {
        restaurantId: dto.restaurantId,
      });
      throw new NotFoundException('Restaurant not found');
    }

    // カテゴリが存在するか確認
    const categoryExists = await this.repo.categoryExists(dto.dishCategory);
    if (!categoryExists) {
      this.logger.warn('CategoryNotFound', 'createDish', {
        dishCategory: dto.dishCategory,
      });
      throw new NotFoundException('Category not found');
    }

    // 料理を作成または取得
    const result = await this.repo.createOrGetDish(dto);

    this.logger.log('DishCreated', 'createDish', {
      dishId: result.id,
      restaurantId: dto.restaurantId,
      dishCategory: dto.dishCategory,
    });

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*                POST /v1/dishes/bulk-import                        */
  /* ------------------------------------------------------------------ */
  async bulkImportDishes(dto: BulkImportDishesDto) {
    this.logger.debug('BulkImportDishes', 'bulkImportDishes', {
      location: dto.location,
      radius: dto.radius,
      category: dto.category,
    });

    // カテゴリが存在するか確認
    const categoryExists = await this.repo.categoryExists(dto.category);
    if (!categoryExists) {
      this.logger.warn('CategoryNotFound', 'bulkImportDishes', {
        category: dto.category,
      });
      throw new NotFoundException('Category not found');
    }

    // Google Places Text Search で レストランを検索
    const searchQuery = `restaurants near ${dto.location}`;
    const places = await this.externalApi.searchPlacesText(
      searchQuery,
      dto.location,
      dto.radius,
    );

    if (places.length === 0) {
      this.logger.warn('NoPlacesFound', 'bulkImportDishes', {
        location: dto.location,
        radius: dto.radius,
      });
      return [];
    }

    const results = [];

    // 各レストランについて処理
    for (const place of places) {
      try {
        const result = await this.prisma.withTransaction(
          async (tx: Prisma.TransactionClient) => {
            // レストラン作成
            const restaurant = await this.repo.createRestaurant(tx, place);

            // 料理作成
            const dish = await this.repo.createDish(
              tx,
              restaurant.id,
              dto.category,
              place.name, // 仮の料理名としてレストラン名を使用
            );

            // 料理メディア作成（写真がある場合）
            let dishMedia = null;
            if (place.photos && place.photos.length > 0) {
              dishMedia = await this.repo.createDishMedia(
                tx,
                dish.id,
                place.photos[0].photo_reference,
              );
            }

            // レビュー作成（レビューがある場合）
            const dishReviews = [];
            if (place.reviews && place.reviews.length > 0) {
              for (const review of place.reviews) {
                const dishReview = await this.repo.createDishReview(
                  tx,
                  dish.id,
                  review,
                );
                dishReviews.push(dishReview);
              }
            }

            return {
              restaurant,
              dish,
              dish_media: dishMedia,
              dish_reviews: dishReviews,
            };
          },
        );

        results.push(result);

        this.logger.log('PlaceImported', 'bulkImportDishes', {
          placeName: place.name,
          restaurantId: result.restaurant.id,
          dishId: result.dish.id,
        });
      } catch (error) {
        this.logger.error('PlaceImportFailed', 'bulkImportDishes', {
          placeName: place.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with other places even if one fails
      }
    }

    this.logger.log('BulkImportCompleted', 'bulkImportDishes', {
      totalPlaces: places.length,
      successfulImports: results.length,
      location: dto.location,
      radius: dto.radius,
    });

    return results;
  }
}