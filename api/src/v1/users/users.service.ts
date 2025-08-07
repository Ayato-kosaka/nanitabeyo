// api/src/v1/users/users.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Storage を編成
// ❷ 1 メソッド = 1 ユースケース（ロギング込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import { Injectable } from '@nestjs/common';

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
  /*                GET /v1/users/:id/dish-reviews                     */
  /* ------------------------------------------------------------------ */
  async getUserDishReviews(userId: string, cursor?: string, viewerId?: string) {
    this.logger.debug('GetUserDishReviews', 'getUserDishReviews', {
      userId,
      cursor,
      viewer: viewerId ?? 'anon',
    });

    const records = await this.repo.findUserDishReviews(userId, cursor);

    // 署名 URL を付与
    const withSignedUrls = await Promise.all(
      records.map(async (rec) => {
        let signedUrl: string | null = null;
        if (rec.dish_media?.media_path) {
          signedUrl = await this.storage.generateSignedUrl(
            rec.dish_media.media_path,
          );
        }
        return {
          ...rec,
          signedUrls: signedUrl ? [signedUrl] : [],
        };
      }),
    );

    this.logger.debug('GetUserDishReviewsResult', 'getUserDishReviews', {
      count: withSignedUrls.length,
    });
    return withSignedUrls;
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/liked-dish-media                    */
  /* ------------------------------------------------------------------ */
  async getMeLikedDishMedia(userId?: string, cursor?: string) {
    if (!userId) {
      this.logger.debug('GetMeLikedDishMedia', 'getMeLikedDishMedia', {
        message: 'No user provided, returning empty',
      });
      return [];
    }

    this.logger.debug('GetMeLikedDishMedia', 'getMeLikedDishMedia', {
      userId,
      cursor,
    });

    const records = await this.repo.findMeLikedDishMedia(userId, cursor);

    // 署名 URL を付与
    const withSignedUrls = await Promise.all(
      records.map(async (rec) => {
        let signedUrl: string | null = null;
        if (rec.dish_media.media_path) {
          signedUrl = await this.storage.generateSignedUrl(
            rec.dish_media.media_path,
          );
        }
        return {
          ...rec,
          dish_media: {
            ...rec.dish_media,
            media_url: signedUrl,
          },
        };
      }),
    );

    this.logger.debug('GetMeLikedDishMediaResult', 'getMeLikedDishMedia', {
      count: withSignedUrls.length,
    });
    return withSignedUrls;
  }

  /* ------------------------------------------------------------------ */
  /*                  GET /v1/users/me/payouts                         */
  /* ------------------------------------------------------------------ */
  async getMePayouts(userId: string, cursor?: string) {
    this.logger.debug('GetMePayouts', 'getMePayouts', {
      userId,
      cursor,
    });

    const records = await this.repo.findMePayouts(userId, cursor);

    this.logger.debug('GetMePayoutsResult', 'getMePayouts', {
      count: records.length,
    });
    return records;
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/restaurant-bids                    */
  /* ------------------------------------------------------------------ */
  async getMeRestaurantBids(userId: string, cursor?: string) {
    this.logger.debug('GetMeRestaurantBids', 'getMeRestaurantBids', {
      userId,
      cursor,
    });

    const records = await this.repo.findMeRestaurantBids(userId, cursor);

    this.logger.debug('GetMeRestaurantBidsResult', 'getMeRestaurantBids', {
      count: records.length,
    });
    return records;
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/saved-dish-categories                */
  /* ------------------------------------------------------------------ */
  async getMeSavedDishCategories(userId?: string, cursor?: string) {
    if (!userId) {
      this.logger.debug(
        'GetMeSavedDishCategories',
        'getMeSavedDishCategories',
        {
          message: 'No user provided, returning empty',
        },
      );
      return [];
    }

    this.logger.debug('GetMeSavedDishCategories', 'getMeSavedDishCategories', {
      userId,
      cursor,
    });

    const records = await this.repo.findMeSavedDishCategories(userId, cursor);

    // 署名 URL を付与
    const withSignedUrls = await Promise.all(
      records.map(async (rec) => {
        let signedUrl: string | null = null;
        if (rec.image_url) {
          signedUrl = await this.storage.generateSignedUrl(rec.image_url);
        }
        return {
          ...rec,
          image_url: signedUrl || rec.image_url,
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
  async getMeSavedDishMedia(userId?: string, cursor?: string) {
    if (!userId) {
      this.logger.debug('GetMeSavedDishMedia', 'getMeSavedDishMedia', {
        message: 'No user provided, returning empty',
      });
      return [];
    }

    this.logger.debug('GetMeSavedDishMedia', 'getMeSavedDishMedia', {
      userId,
      cursor,
    });

    const records = await this.repo.findMeSavedDishMedia(userId, cursor);

    // 署名 URL を付与
    const withSignedUrls = await Promise.all(
      records.map(async (rec) => {
        let signedUrl: string | null = null;
        if (rec.dish_media.media_path) {
          signedUrl = await this.storage.generateSignedUrl(
            rec.dish_media.media_path,
          );
        }
        return {
          ...rec,
          dish_media: {
            ...rec.dish_media,
            media_url: signedUrl,
          },
        };
      }),
    );

    this.logger.debug('GetMeSavedDishMediaResult', 'getMeSavedDishMedia', {
      count: withSignedUrls.length,
    });
    return withSignedUrls;
  }
}
