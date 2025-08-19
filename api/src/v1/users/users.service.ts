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

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                  GET /v1/users/:id/dish-reviews                   */
  /* ------------------------------------------------------------------ */
  async getUserDishReviews(userId: string, dto: QueryUserDishReviewsDto) {
    this.logger.debug('GetUserDishReviews', 'getUserDishReviews', {
      userId,
      cursor: dto.cursor,
    });

    const records = await this.repo.findUserDishReviews(userId, dto.cursor);

    // 署名 URL を付与
    const withSignedUrls = await Promise.all(
      records.map(async (rec) => {
        const signedUrls: string[] = [];
        const hasMedia = !!rec.dish_media;

        if (hasMedia && rec.dish_media?.media_path) {
          const signedUrl = await this.storage.generateSignedUrl(
            rec.dish_media.media_path,
          );
          signedUrls.push(signedUrl);
        }

        return {
          dish_media: rec.dish_media,
          dish_review: rec,
          signedUrls,
          hasMedia,
        };
      }),
    );

    this.logger.debug('GetUserDishReviewsResult', 'getUserDishReviews', {
      count: withSignedUrls.length,
    });

    return withSignedUrls;
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/liked-dish-media                  */
  /* ------------------------------------------------------------------ */
  async getMeLikedDishMedia(userId: string, dto: QueryMeLikedDishMediaDto) {
    this.logger.debug('GetMeLikedDishMedia', 'getMeLikedDishMedia', {
      userId,
      cursor: dto.cursor,
    });

    const records = await this.repo.findUserLikedDishMedia(userId, dto.cursor);

    // 署名 URL を付与
    const withSignedUrls = await Promise.all(
      records.map(async (rec) => {
        let signedUrl = '';
        if (rec.media_path) {
          signedUrl = await this.storage.generateSignedUrl(rec.media_path);
        }

        return {
          restaurant: rec.restaurants,
          dish: rec.dishes,
          dish_media: {
            ...rec,
            media_url: signedUrl,
          },
          dish_reviews: rec.dish_reviews,
        };
      }),
    );

    this.logger.debug('GetMeLikedDishMediaResult', 'getMeLikedDishMedia', {
      count: withSignedUrls.length,
    });

    return withSignedUrls;
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

    this.logger.debug('GetMePayoutsResult', 'getMePayouts', {
      count: records.length,
    });

    return records;
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

    this.logger.debug('GetMeRestaurantBidsResult', 'getMeRestaurantBids', {
      count: records.length,
    });

    return records;
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

    // 署名 URL を付与
    const withSignedUrls = await Promise.all(
      records.map(async (rec) => {
        let signedUrl = '';
        if (rec.image_url) {
          signedUrl = await this.storage.generateSignedUrl(rec.image_url);
        }

        return {
          ...rec,
          image_url: signedUrl,
        };
      }),
    );

    this.logger.debug(
      'GetMeSavedDishCategoriesResult',
      'getMeSavedDishCategories',
      {
        count: withSignedUrls.length,
      },
    );

    return withSignedUrls;
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/saved-dish-media                   */
  /* ------------------------------------------------------------------ */
  async getMeSavedDishMedia(userId: string, dto: QueryMeSavedDishMediaDto) {
    this.logger.debug('GetMeSavedDishMedia', 'getMeSavedDishMedia', {
      userId,
      cursor: dto.cursor,
    });

    const records = await this.repo.findUserSavedDishMedia(userId, dto.cursor);

    // 署名 URL を付与
    const withSignedUrls = await Promise.all(
      records.map(async (rec) => {
        let signedUrl = '';
        if (rec.media_path) {
          signedUrl = await this.storage.generateSignedUrl(rec.media_path);
        }

        return {
          restaurant: rec.restaurants,
          dish: rec.dishes,
          dish_media: {
            ...rec,
            media_url: signedUrl,
          },
          dish_reviews: rec.dish_reviews,
        };
      }),
    );

    this.logger.debug('GetMeSavedDishMediaResult', 'getMeSavedDishMedia', {
      count: withSignedUrls.length,
    });

    return withSignedUrls;
  }
}
