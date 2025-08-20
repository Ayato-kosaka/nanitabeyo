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
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { DishMediaService } from '../dish-media/dish-media.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
    private readonly dishMediaRepo: DishMediaRepository,
    private readonly dishMediaService: DishMediaService,
  ) { }

  /* ------------------------------------------------------------------ */
  /*                  GET /v1/users/:id/dish-reviews                   */
  /* ------------------------------------------------------------------ */
  async getUserDishReviews(userId: string, dto: QueryUserDishReviewsDto) {
    this.logger.debug('GetUserDishReviews', 'getUserDishReviews', {
      userId,
      cursor: dto.cursor,
    });

    const reviews = await this.dishMediaRepo.findDishReviewsByUser(userId, dto.cursor);

    const dishMediaEntries = await this.dishMediaService.fetchDishMediaEntryItems(
      reviews.map(review => review.created_dish_media_id),
      { userId, reviewLimit: 0 },
    );

    const nextCursor =
      reviews.length > 0
        ? reviews[reviews.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetUserDishReviewsResult', 'getUserDishReviews', {
      count: reviews.length,
      nextCursor,
    });

    return {
      data: dishMediaEntries.map(list => ({
        ...list,
        dish_media: {
          ...list.dish_media,
          isMe: list.dish_media.user_id === userId
        },
        dish_reviews: reviews.filter(review => review.created_dish_media_id === list.dish_media.id)
      })),
      nextCursor,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/liked-dish-media                  */
  /* ------------------------------------------------------------------ */
  async getMeLikedDishMedia(userId: string, dto: QueryMeLikedDishMediaDto) {
    this.logger.debug('GetMeLikedDishMedia', 'getMeLikedDishMedia', {
      userId,
      cursor: dto.cursor,
    });

    const likes = await this.dishMediaRepo.findDishMediaByLikedUser(
      userId,
      dto.cursor,
    );

    const dishMediaIds = likes.map(l => l.dish_media_id);

    const dishMediaEntries = await this.dishMediaService.fetchDishMediaEntryItems(
      dishMediaIds,
      { userId },
    );

    const nextCursor =
      likes.length > 0
        ? likes[likes.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetMeLikedDishMediaResult', 'getMeLikedDishMedia', {
      count: dishMediaEntries.length,
      nextCursor,
    });

    return {
      data: dishMediaEntries,
      nextCursor,
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

    const records = await this.repo.findUserSavedDishCategories(
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

    const dishMediaIds = saves.map(s => s.dish_media_id);

    const dishMediaEntries = await this.dishMediaService.fetchDishMediaEntryItems(
      dishMediaIds,
      { userId },
    );

    const nextCursor =
      saves.length > 0
        ? saves[saves.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetMeSavedDishMediaResult', 'getMeSavedDishMedia', {
      count: dishMediaEntries.length,
      nextCursor,
    });

    return {
      data: dishMediaEntries,
      nextCursor,
    };
  }
}
