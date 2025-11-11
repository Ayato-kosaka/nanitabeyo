// api/src/v1/users/users.service.ts
//
// ❶ Controller から渡される DTO を受け取り Repository・Storage を編成
// ❷ 1 メソッド = 1 ユースケース（署名 URL 生成込み）
// ❸ "副作用" は出来るだけ Service で完結させ、Controller は薄く保つ
//

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

import {
  QueryUserDishReviewsDto,
  QueryMeLikedDishMediaDto,
  QueryMePayoutsDto,
  QueryMeRestaurantBidsDto,
  QueryMeSavedDishCategoriesDto,
  QueryMeSavedDishMediaDto,
  UpdateUserProfileDto,
} from '@shared/v1/dto';

import { UsersRepository } from './users.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { isValidUserUploadedPath } from 'src/core/storage/storage.utils';
import { CloudTasksService } from 'src/core/cloud-tasks/cloud-tasks.service';
import { UsersAssembler } from './users.assembler';
import { DishMediaEntry } from '@shared/v1/res';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly assembler: UsersAssembler,
    private readonly logger: AppLoggerService,
    private readonly dishMediaRepo: DishMediaRepository,
    private readonly dishMediaService: DishMediaService,
    private readonly dishCategoriesRepo: DishCategoriesRepository,
    private readonly cloudTasks: CloudTasksService,
  ) {}

  async getUserByIds(userId: string[]) {
    return this.repo.getUserByIds(userId);
  }

  /* ------------------------------------------------------------------ */
  /*                  GET /v1/users/:id/dish-reviews                   */
  /* ------------------------------------------------------------------ */
  async getUserDishReviews(
    userId: string,
    dto: QueryUserDishReviewsDto,
  ): Promise<{
    data: (DishMediaEntry & { dish_media: { isMe: boolean } })[];
    nextCursor: string | null;
    cdnCookies: string[];
  }> {
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
    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(uniqueDishMediaIds, {
        userId,
        reviewLimit: 0,
      });

    const dishMediaMap = new Map<
      string,
      (typeof dishMediaEntryItemsResult.items)[0]
    >(
      dishMediaEntryItemsResult.items.map((item) => [item.dish_media.id, item]),
    );

    const nextCursor =
      reviews.length > 0
        ? reviews[reviews.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetUserDishReviewsResult', 'getUserDishReviews', {
      count: reviews.length,
      nextCursor,
      hasCookies: !!dishMediaEntryItemsResult.cdnCookies,
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
            dish_reviews: [
              {
                ...review,
                ...convertPrismaToSupabase_DishReviews(review),
              },
            ],
          };
        })
        .filter((item) => item !== undefined),
      nextCursor,
      cdnCookies: dishMediaEntryItemsResult.cdnCookies,
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

    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(dishMediaIds, {
        userId,
      });

    const nextCursor =
      likes.length > 0
        ? likes[likes.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetMeLikedDishMediaResult', 'getMeLikedDishMedia', {
      count: dishMediaEntryItemsResult.items.length,
      nextCursor,
      hasCookies: !!dishMediaEntryItemsResult.cdnCookies,
    });

    return {
      data: dishMediaEntryItemsResult.items,
      nextCursor,
      cdnCookies: dishMediaEntryItemsResult.cdnCookies,
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

    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(dishMediaIds, {
        userId,
      });

    const nextCursor =
      saves.length > 0
        ? saves[saves.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('GetMeSavedDishMediaResult', 'getMeSavedDishMedia', {
      count: dishMediaEntryItemsResult.items.length,
      nextCursor,
      hasCookies: !!dishMediaEntryItemsResult.cdnCookies,
    });

    return {
      data: dishMediaEntryItemsResult.items,
      nextCursor,
      cdnCookies: dishMediaEntryItemsResult.cdnCookies,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                      GET /v1/users/:id                             */
  /* ------------------------------------------------------------------ */
  async getUserProfile(userId: string) {
    this.logger.debug('GetUserProfile', 'getUserProfile', { userId });

    const user = await this.repo.getUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.assembler.enrichUserProfileWithAvatarUrls(user);
  }

  /* ------------------------------------------------------------------ */
  /*                      POST /v1/users/me                             */
  /* ------------------------------------------------------------------ */
  async updateUserProfile(userId: string, dto: UpdateUserProfileDto) {
    this.logger.debug('UpdateUserProfile', 'updateUserProfile', {
      userId,
      dto,
    });

    // ユーザーが存在するか確認
    const existingUser = await this.repo.getUserById(userId);
    if (!existingUser) throw new NotFoundException('User not found');

    // #プロフィール画像 【設計】avatar_path が指定された場合のみ処理
    if (dto.avatar_path) {
      // #セキュリティ 【検証】ユーザーアップロード領域に限る
      if (!isValidUserUploadedPath(dto.avatar_path, userId))
        throw new ForbiddenException('Invalid avatar_path');

      // 画像のリサイズと保存を実行（プロフィールのサムネ用）
      await this.cloudTasks.enqueueResizeImage({
        table: 'users',
        column: 'avatar_path',
        recordId: userId,
        size: 256,
        originalPath: dto.avatar_path,
      });

      // 画像のリサイズと保存を実行（コメント欄用）
      await this.cloudTasks.enqueueResizeImage({
        table: 'users',
        column: 'avatar_path',
        recordId: userId,
        size: 64,
        originalPath: dto.avatar_path,
      });
    }

    const updatedUser = await this.repo.updateUserProfile({
      ...dto,
      id: userId,
    });

    return this.assembler.enrichUserProfileWithAvatarUrls(updatedUser);
  }
}
