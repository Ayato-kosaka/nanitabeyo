// api/src/v1/users/users.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Storage を編成
// ❷ 1 メソッド = 1 ユースケース（署名 URL 生成込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import { Injectable } from '@nestjs/common';

import {
  QueryUserDishReviewsDto,
  QueryMeLikedDishMediaDto,
  QueryMePayoutsDto,
  QueryMeRestaurantBidsDto,
  QueryMeSavedDishCategoriesDto,
  QueryMeSavedDishMediaDto,
} from '@shared/v1/dto';

import { UsersRepository } from './users.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly logger: AppLoggerService,
    private readonly dishMediaRepo: DishMediaRepository,
    private readonly dishMediaService: DishMediaService,
    private readonly dishCategoriesRepo: DishCategoriesRepository,
  ) {}

  async getUserByIds(userId: string[]) {
    return this.repo.getUserByIds(userId);
  }

  /* ------------------------------------------------------------------ */
  /*                  GET /v1/users/:id/dish-reviews                   */
  /* ------------------------------------------------------------------ */
  async getUserDishReviews(userId: string, dto: QueryUserDishReviewsDto) {
    this.logger.debug('GetUserDishReviews', 'getUserDishReviews', {
      userId,
      cursor: dto.cursor,
    });

    const reviews = await this.dishMediaRepo.findDishReviewsByUser(
      userId,
      dto.cursor,
    );

    const uniqueDishMediaIds = Array.from(
      new Set(reviews.map((r) => r.created_dish_media_id)),
    );
    const result = await this.dishMediaService.fetchDishMediaEntryItems(
      uniqueDishMediaIds,
      { userId, reviewLimit: 0 },
    );

    const dishMediaMap = new Map<string, (typeof result.items)[0]>(
      result.items.map((item) => [item.dish_media.id, item]),
    );

    const nextCursor =
      reviews.length > 0
        ? reviews[reviews.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetUserDishReviewsResult', 'getUserDishReviews', {
      count: reviews.length,
      nextCursor,
      hasCookies: !!result.cdnCookies,
    });

    return {
      data: reviews
        .map((review) => {
          const dishMediaEntryItem = dishMediaMap.get(
            review.created_dish_media_id,
          );
          if (!dishMediaEntryItem) {
            this.logger.warn(
              'DishMediaEntryItem not found for review',
              'getUserDishReviews',
              {
                reviewId: review.id,
                dishMediaId: review.created_dish_media_id,
              },
            );
            return undefined;
          }
          return {
            ...dishMediaEntryItem,
            dish_media: {
              ...dishMediaEntryItem?.dish_media,
              isMe: dishMediaEntryItem?.dish_media.user_id === userId,
            },
            dish_reviews: [review],
          };
        })
        .filter((item) => item !== undefined),
      nextCursor,
      cdnCookies: result.cdnCookies,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/liked-dish-media                  */
  /* ------------------------------------------------------------------ */
  async getMeLikedDishMedia(
    userId: string,
    isAnonymous: boolean,
    dto: QueryMeLikedDishMediaDto,
  ) {
    this.logger.debug('GetMeLikedDishMedia', 'getMeLikedDishMedia', {
      userId,
      cursor: dto.cursor,
    });

    const likes = await this.dishMediaRepo.findDishMediaByLikedUser(
      userId,
      isAnonymous,
      dto.cursor,
    );

    const dishMediaIds = likes.map((l) => l.dish_media_id);

    const result = await this.dishMediaService.fetchDishMediaEntryItems(
      dishMediaIds,
      {
        userId,
      },
    );

    const nextCursor =
      likes.length > 0
        ? likes[likes.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetMeLikedDishMediaResult', 'getMeLikedDishMedia', {
      count: result.items.length,
      nextCursor,
      hasCookies: !!result.cdnCookies,
    });

    return {
      data: result.items,
      nextCursor,
      cdnCookies: result.cdnCookies,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                     GET /v1/users/me/payouts                      */
  /* ------------------------------------------------------------------ */
  async getMePayouts(userId: string, dto: QueryMePayoutsDto) {
    this.logger.debug('GetMePayouts', 'getMePayouts', {
      userId,
      cursor: dto.cursor,
    });

    const records = await this.repo.findUserPayouts(userId, dto.cursor);

    // Generate nextCursor from last item's created_at
    const nextCursor =
      records.length > 0
        ? records[records.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetMePayoutsResult', 'getMePayouts', {
      count: records.length,
      nextCursor,
    });

    return {
      data: records,
      nextCursor,
    };
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/restaurant-bids                    */
  /* ------------------------------------------------------------------ */
  async getMeRestaurantBids(userId: string, dto: QueryMeRestaurantBidsDto) {
    this.logger.debug('GetMeRestaurantBids', 'getMeRestaurantBids', {
      userId,
      cursor: dto.cursor,
    });

    const records = await this.repo.findUserRestaurantBids(userId, dto.cursor);

    // Generate nextCursor from last item's created_at
    const nextCursor =
      records.length > 0
        ? records[records.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetMeRestaurantBidsResult', 'getMeRestaurantBids', {
      count: records.length,
      nextCursor,
    });

    return {
      data: records,
      nextCursor,
    };
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/saved-dish-categories                */
  /* ------------------------------------------------------------------ */
  async getMeSavedDishCategories(
    userId: string,
    dto: QueryMeSavedDishCategoriesDto,
  ) {
    this.logger.debug('GetMeSavedDishCategories', 'getMeSavedDishCategories', {
      userId,
      cursor: dto.cursor,
    });

    const records = await this.dishCategoriesRepo.findDishCategoriesBySavedUser(
      userId,
      dto.cursor,
    );

    this.logger.debug(
      'GetMeSavedDishCategoriesResult',
      'getMeSavedDishCategories',
      {
        count: records.length,
        nextCursor:
          records.length > 0
            ? records[records.length - 1].created_at.toISOString()
            : null,
      },
    );

    return {
      data: records,
      nextCursor:
        records.length > 0
          ? records[records.length - 1].created_at.toISOString()
          : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/saved-dish-media                   */
  /* ------------------------------------------------------------------ */
  async getMeSavedDishMedia(userId: string, dto: QueryMeSavedDishMediaDto) {
    this.logger.debug('GetMeSavedDishMedia', 'getMeSavedDishMedia', {
      userId,
      cursor: dto.cursor,
    });

    const saves = await this.dishMediaRepo.findDishMediaBySavedUser(
      userId,
      dto.cursor,
    );

    const dishMediaIds = saves.map((s) => s.dish_media_id);

    const result = await this.dishMediaService.fetchDishMediaEntryItems(
      dishMediaIds,
      {
        userId,
      },
    );

    const nextCursor =
      saves.length > 0
        ? saves[saves.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetMeSavedDishMediaResult', 'getMeSavedDishMedia', {
      count: result.items.length,
      nextCursor,
      hasCookies: !!result.cdnCookies,
    });

    return {
      data: result.items,
      nextCursor,
      cdnCookies: result.cdnCookies,
    };
  }
}
