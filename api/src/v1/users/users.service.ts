// api/src/modules/users/users.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Storage・Notifier を編成
// ❷ 1 メソッド = 1 ユースケース（トランザクション／ロギング込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import { Injectable, ForbiddenException } from '@nestjs/common';

import {
  QueryUserDishReviewsDto,
  QueryMeLikedDishMediaDto,
  QueryMePayoutsDto,
  QueryMeRestaurantBidsDto,
  QueryMeSavedDishCategoriesDto,
  QueryMeSavedDishMediaDto,
} from '@shared/v1/dto';

import { UsersRepository, UserDishReviewItem, LikedDishMediaItem, SavedDishMediaItem } from './users.repository';
import { StorageService } from '../../core/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaPayouts } from '../../../../shared/converters/convert_payouts';
import { PrismaRestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import { PrismaDishCategories } from '../../../../shared/converters/convert_dish_categories';

interface UserDishReviewWithSignedUrl extends UserDishReviewItem {
  signedUrls: string[];
}

interface LikedDishMediaWithSignedUrl extends LikedDishMediaItem {
  signedUrls: string[];
}

interface SavedDishMediaWithSignedUrl extends SavedDishMediaItem {
  signedUrls: string[];
}

interface SavedDishCategoriesWithSignedUrl extends PrismaDishCategories {
  signedUrls: string[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                  GET /v1/users/:id/dish-reviews                    */
  /* ------------------------------------------------------------------ */
  async getUserDishReviews(
    userId: string, 
    dto: QueryUserDishReviewsDto,
    viewerId?: string,
  ): Promise<UserDishReviewWithSignedUrl[]> {
    this.logger.debug('GetUserDishReviews', 'getUserDishReviews', {
      userId,
      cursor: dto.cursor,
      viewer: viewerId ?? 'anon',
    });

    const records = await this.repo.getUserDishReviews(userId, dto);

    // 署名 URL を付与
    const withSignedUrl = await Promise.all(
      records.map(async (rec) => {
        const signedUrls: string[] = [];
        if (rec.dish_media?.media_path) {
          const signedUrl = await this.storage.generateSignedUrl(
            rec.dish_media.media_path,
          );
          signedUrls.push(signedUrl);
        }
        return {
          ...rec,
          signedUrls,
        };
      }),
    );

    this.logger.debug('GetUserDishReviewsResult', 'getUserDishReviews', {
      count: withSignedUrl.length,
    });
    return withSignedUrl;
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/liked-dish-media                   */
  /* ------------------------------------------------------------------ */
  async getMeLikedDishMedia(
    dto: QueryMeLikedDishMediaDto,
    userId?: string,
  ): Promise<LikedDishMediaWithSignedUrl[]> {
    this.logger.debug('GetMeLikedDishMedia', 'getMeLikedDishMedia', {
      cursor: dto.cursor,
      userId: userId ?? 'anon',
    });

    if (!userId) {
      return []; // 未ログインの場合は空配列を返す（OptionalJwtAuthGuard）
    }

    const records = await this.repo.getMeLikedDishMedia(userId, dto);

    // 署名 URL を付与
    const withSignedUrl = await Promise.all(
      records.map(async (rec) => {
        const signedUrls: string[] = [];
        if (rec.dish_media?.media_path) {
          const signedUrl = await this.storage.generateSignedUrl(
            rec.dish_media.media_path,
          );
          signedUrls.push(signedUrl);
        }
        return {
          ...rec,
          signedUrls,
        };
      }),
    );

    this.logger.debug('GetMeLikedDishMediaResult', 'getMeLikedDishMedia', {
      count: withSignedUrl.length,
    });
    return withSignedUrl;
  }

  /* ------------------------------------------------------------------ */
  /*                   GET /v1/users/me/payouts                         */
  /* ------------------------------------------------------------------ */
  async getMePayouts(
    dto: QueryMePayoutsDto,
    userId: string,
  ): Promise<PrismaPayouts[]> {
    this.logger.debug('GetMePayouts', 'getMePayouts', {
      cursor: dto.cursor,
      userId,
    });

    const records = await this.repo.getMePayouts(userId, dto);

    this.logger.debug('GetMePayoutsResult', 'getMePayouts', {
      count: records.length,
    });
    return records;
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/restaurant-bids                    */
  /* ------------------------------------------------------------------ */
  async getMeRestaurantBids(
    dto: QueryMeRestaurantBidsDto,
    userId: string,
  ): Promise<PrismaRestaurantBids[]> {
    this.logger.debug('GetMeRestaurantBids', 'getMeRestaurantBids', {
      cursor: dto.cursor,
      userId,
    });

    const records = await this.repo.getMeRestaurantBids(userId, dto);

    this.logger.debug('GetMeRestaurantBidsResult', 'getMeRestaurantBids', {
      count: records.length,
    });
    return records;
  }

  /* ------------------------------------------------------------------ */
  /*              GET /v1/users/me/saved-dish-categories                */
  /* ------------------------------------------------------------------ */
  async getMeSavedDishCategories(
    dto: QueryMeSavedDishCategoriesDto,
    userId?: string,
  ): Promise<SavedDishCategoriesWithSignedUrl[]> {
    this.logger.debug('GetMeSavedDishCategories', 'getMeSavedDishCategories', {
      cursor: dto.cursor,
      userId: userId ?? 'anon',
    });

    if (!userId) {
      return []; // 未ログインの場合は空配列を返す（OptionalJwtAuthGuard）
    }

    const records = await this.repo.getMeSavedDishCategories(userId, dto);

    // 署名 URL を付与
    const withSignedUrl = await Promise.all(
      records.map(async (rec) => {
        const signedUrls: string[] = [];
        if (rec.image_url) {
          const signedUrl = await this.storage.generateSignedUrl(
            rec.image_url,
          );
          signedUrls.push(signedUrl);
        }
        return {
          ...rec,
          signedUrls,
        };
      }),
    );

    this.logger.debug('GetMeSavedDishCategoriesResult', 'getMeSavedDishCategories', {
      count: withSignedUrl.length,
    });
    return withSignedUrl;
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/saved-dish-media                   */
  /* ------------------------------------------------------------------ */
  async getMeSavedDishMedia(
    dto: QueryMeSavedDishMediaDto,
    userId?: string,
  ): Promise<SavedDishMediaWithSignedUrl[]> {
    this.logger.debug('GetMeSavedDishMedia', 'getMeSavedDishMedia', {
      cursor: dto.cursor,
      userId: userId ?? 'anon',
    });

    if (!userId) {
      return []; // 未ログインの場合は空配列を返す（OptionalJwtAuthGuard）
    }

    const records = await this.repo.getMeSavedDishMedia(userId, dto);

    // 署名 URL を付与
    const withSignedUrl = await Promise.all(
      records.map(async (rec) => {
        const signedUrls: string[] = [];
        if (rec.dish_media?.media_path) {
          const signedUrl = await this.storage.generateSignedUrl(
            rec.dish_media.media_path,
          );
          signedUrls.push(signedUrl);
        }
        return {
          ...rec,
          signedUrls,
        };
      }),
    );

    this.logger.debug('GetMeSavedDishMediaResult', 'getMeSavedDishMedia', {
      count: withSignedUrl.length,
    });
    return withSignedUrl;
  }
}