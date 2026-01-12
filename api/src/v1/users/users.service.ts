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
  QuerySavedRestaurantsDto,
} from '@shared/v1/dto';

import { UsersRepository } from './users.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import { isValidUserUploadedPath } from 'src/core/storage/storage.utils';
import { CloudTasksService } from 'src/core/cloud-tasks/cloud-tasks.service';
import { UsersAssembler } from './users.assembler';
import { DishMediaEntry } from '@shared/v1/res';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { PrismaService } from '../../prisma/prisma.service';

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
    private readonly restaurantsRepo: RestaurantsRepository,
    private readonly prisma: PrismaService,
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
    data: DishMediaEntry[];
    nextCursor: string | null;
  }> {
    this.logger.debug('GetUserDishReviews', 'getUserDishReviews', {
      userId,
      cursor: dto.cursor,
    });

    const { items: reviews, nextCursor } =
      await this.dishMediaRepo.findDishReviewsByUser(userId, {
        type: 'cursor',
        cursor: dto.cursor,
      });

    const uniqueDishMediaIds = Array.from(
      new Set(reviews.map((r) => r.created_dish_media_id)),
    );
    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(uniqueDishMediaIds, {
        userId,
      });

    const dishMediaMap = new Map<
      string,
      (typeof dishMediaEntryItemsResult.items)[0]
    >(
      dishMediaEntryItemsResult.items.map((item) => [item.dish_media.id, item]),
    );

    this.logger.debug('GetUserDishReviewsResult', 'getUserDishReviews', {
      count: reviews.length,
      nextCursor,
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
            dish_reviews: [
              {
                ...review,
                ...convertPrismaToSupabase_DishReviews(review),
              },
              ...dishMediaEntryItem.dish_reviews.filter(
                (dr) => dr.id !== review.id,
              ),
            ],
          };
        })
        .filter((item) => item !== undefined),
      nextCursor,
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

    const { items: likes, nextCursor } =
      await this.dishMediaRepo.findDishMediaByLikedUser(
        userId,
        isAnonymous,
        dto.cursor,
      );

    const dishMediaIds = likes.map((l) => l.dish_media_id);

    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(dishMediaIds, {
        userId,
      });

    this.logger.debug('GetMeLikedDishMediaResult', 'getMeLikedDishMedia', {
      count: dishMediaEntryItemsResult.items.length,
      nextCursor,
    });

    return {
      data: dishMediaEntryItemsResult.items,
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

    const { items: records, nextCursor } = await this.repo.findUserPayouts(
      userId,
      dto.cursor,
    );

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

    const { items: records, nextCursor } =
      await this.repo.findUserRestaurantBids(userId, dto.cursor);

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

    const { items: records, nextCursor } =
      await this.dishCategoriesRepo.findDishCategoriesBySavedUser(
        userId,
        dto.cursor,
      );

    this.logger.debug(
      'GetMeSavedDishCategoriesResult',
      'getMeSavedDishCategories',
      {
        count: records.length,
        nextCursor,
      },
    );

    return {
      data: records,
      nextCursor,
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

    const { items: saves, nextCursor } =
      await this.dishMediaRepo.findDishMediaBySavedUser(userId, dto.cursor);

    const dishMediaIds = saves.map((s) => s.dish_media_id);

    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(dishMediaIds, {
        userId,
      });

    this.logger.debug('GetMeSavedDishMediaResult', 'getMeSavedDishMedia', {
      count: dishMediaEntryItemsResult.items.length,
      nextCursor,
    });

    return {
      data: dishMediaEntryItemsResult.items,
      nextCursor,
    };
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/saved-restaurants                    */
  /* ------------------------------------------------------------------ */
  // #644 【設計】保存したお店を位置情報で検索
  async getMySavedNearbyRestaurants(
    userId: string,
    dto: QuerySavedRestaurantsDto,
  ) {
    this.logger.debug(
      'GetMySavedNearbyRestaurants',
      'getMySavedNearbyRestaurants',
      {
        userId,
        lat: dto.lat,
        lng: dto.lng,
        radius: dto.radius,
        limit: dto.limit,
        offset: dto.offset,
      },
    );

    const items = await this.prisma.$transaction(async (tx) => {
      return this.restaurantsRepo.searchNearbySavedRestaurants(tx, {
        lat: dto.lat,
        lng: dto.lng,
        radius: dto.radius,
        limit: dto.limit ?? 20,
        offset: dto.offset ?? 0,
        userId,
      });
    });

    // #644 【設計】nextCursor 計算（offset + 件数）
    const nextCursor =
      items.length < (dto.limit ?? 20)
        ? null
        : String((dto.offset ?? 0) + items.length);

    this.logger.debug(
      'GetMySavedNearbyRestaurantsResult',
      'getMySavedNearbyRestaurants',
      {
        count: items.length,
        nextCursor,
      },
    );

    return {
      data: items,
      nextCursor,
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
