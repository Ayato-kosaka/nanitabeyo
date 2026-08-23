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
  ServiceUnavailableException,
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
  QueryMeBlockedDishCategoriesDto,
} from '@shared/v1/dto';

import { UsersRepository } from './users.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishCategoriesRepository } from '../dish-categories/dish-categories.repository';
import { RestaurantsRepository } from '../restaurants/restaurants.repository';
import {
  buildDerivedPrefix,
  isValidUserUploadedPath,
} from 'src/core/storage/storage.utils';
import { StorageService } from 'src/core/storage/storage.service';
import {
  SupabaseAdminNotConfiguredError,
  SupabaseAdminService,
} from 'src/core/supabase-admin/supabase-admin.service';
import { CloudTasksService } from 'src/core/cloud-tasks/cloud-tasks.service';
import { UsersAssembler } from './users.assembler';
import { DishMediaEntry } from '@shared/v1/res';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { RestaurantsAssembler } from '../restaurants/restaurants.assembler';

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
    private readonly restaurantsAssembler: RestaurantsAssembler,
    private readonly storage: StorageService,
    private readonly supabaseAdmin: SupabaseAdminService,
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

    const items = await this.restaurantsRepo.searchNearbySavedRestaurants(
      {
        lat: dto.lat,
        lng: dto.lng,
        radius: dto.radius,
        limit: dto.limit ?? 20,
        offset: dto.offset ?? 0,
      },
      userId,
    );

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
      data: items.map((i) => ({
        restaurant: this.restaurantsAssembler.enrichRestaurantsWithImageUrls(
          i.restaurant,
        ),
        meta: {
          ...i.meta,
          lastSavedAt: i.meta.lastSavedAt
            ? i.meta.lastSavedAt.toISOString()
            : null,
        },
      })),
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

  /* ------------------------------------------------------------------ */
  /*                     DELETE /v1/users/me（#1511）                   */
  /* ------------------------------------------------------------------ */
  /**
   * アカウントを削除する（ACC-01）。
   *
   * ## 手順（この順序に意味がある）
   * 1. **削除対象の実体パスを控える**（アバター / 投稿メディア）。
   *    匿名化トランザクションが `avatar_path` を NULL にするので、先に読まないと消せなくなる。
   * 2. **DB を 1 トランザクションで匿名化**する（users.repository.softDeleteUserAccount）。
   *    ここが通れば、この時点でアプリのどの読み取り経路からも本人は見えなくなる。
   * 3. **GCS の実体を削除**する。失敗しても DB の状態は正しいので、記録して先へ進む
   *    （オブジェクトは再実行で回収できる。ここで throw すると auth 削除へ到達しない）。
   * 4. **Supabase Auth のアカウントを物理削除**する。ここは失敗を握り潰さない。
   *    握り潰すと「削除したのに同じ資格情報でログインできる」状態を成功として返してしまう。
   *
   * ## 冪等性
   * 3 と 4 は「既に無い」を成功として扱う。2 は updateMany / deleteMany で書いてある。
   * したがって途中で落ちた削除は、同じリクエストの再送で最後まで完了できる。
   *
   * ## この操作は取り消せない
   * auth 側を実体ごと消すため、同じ資格情報での再ログイン経路は残らない。
   * クライアントは実行前に必ず確認ダイアログでその旨を明示すること
   * （app-expo/app/[locale]/(tabs)/profile/settings.tsx）。
   */
  async deleteMe(userId: string): Promise<{
    success: boolean;
    deletedAt: string;
  }> {
    this.logger.log('DeleteMeStarted', 'deleteMe', { userId });

    // ── 1. 実体パスを控える（匿名化で avatar_path が消える前に） ──────────
    // ⚠️ `getUserById` ではなく削除済みも引ける方を使う。再実行で「居ない」と誤判定させない
    const user = await this.repo.getUserByIdIncludingDeleted(userId);
    if (!user) throw new NotFoundException('User not found');

    const avatarPath = user.avatar_path;
    const dishMedias = await this.repo.findDishMediaPathsByUser(userId);

    // ── 2. DB の匿名化（1 トランザクション） ─────────────────────────
    const result = await this.repo.softDeleteUserAccount(userId);

    // ── 3. GCS の実体削除（失敗しても先へ進む） ──────────────────────
    await this.deleteStorageObjectsForUser(userId, avatarPath, dishMedias);

    // ── 4. Supabase Auth の物理削除（ここは失敗を握り潰さない） ────────
    try {
      await this.supabaseAdmin.deleteAuthUser(userId);
    } catch (err) {
      if (err instanceof SupabaseAdminNotConfiguredError) {
        // service_role 鍵が未配線の環境。DB 側の匿名化は完了しているので再実行で完了できる。
        // 「成功」を返してはいけない: 認証が生きたままだと再ログインできてしまう
        this.logger.error('DeleteMeAuthNotConfigured', 'deleteMe', { userId });
        throw new ServiceUnavailableException(
          'Account data was anonymized, but the authentication account could not be deleted because the Supabase admin credentials are not configured. Retry after configuring SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.',
        );
      }
      this.logger.error('DeleteMeAuthDeleteFailed', 'deleteMe', {
        userId,
        error_message: (err as Error).message,
      });
      throw new ServiceUnavailableException(
        'Account data was anonymized, but the authentication account could not be deleted. Please retry.',
      );
    }

    this.logger.log('DeleteMeCompleted', 'deleteMe', {
      userId,
      ...result,
      deletedAt: result.deletedAt.toISOString(),
      dishMediaObjectsTargeted: dishMedias.length,
    });

    return { success: true, deletedAt: result.deletedAt.toISOString() };
  }

  /**
   * #1511 削除ユーザーのストレージ実体を消す。
   *
   * オリジナルと派生（リサイズ画像・トランスコード動画）の両方を対象にする。
   * 派生はサイズ・フォーマットの一覧を呼び出し側が知らないため、レコード単位の
   * 前方一致で消す（storage.utils の `buildDerivedPrefix`）。
   *
   * ⚠️ **ここでは throw しない。** ストレージの失敗で auth 削除へ到達しないと、
   * 「消えていないのにログインもできない」より悪い「ログインできるまま」になる。
   * 取りこぼしはログに残し、再実行で回収する。
   */
  private async deleteStorageObjectsForUser(
    userId: string,
    avatarPath: string | null,
    dishMedias: { id: string; media_path: string; thumbnail_path: string }[],
  ): Promise<void> {
    try {
      // アバター: オリジナル + 派生（64 / 256）
      if (avatarPath) await this.storage.deleteFileIfExists(avatarPath);
      await this.storage.deleteFilesByPrefix(
        buildDerivedPrefix({
          kind: 'resized-image',
          table: 'users',
          column: 'avatar_path',
          recordId: userId,
        }),
      );

      // 投稿メディア: オリジナル（動画/画像・サムネ） + 派生（リサイズ・HLS）
      for (const media of dishMedias) {
        await this.storage.deleteFileIfExists(media.media_path);
        await this.storage.deleteFileIfExists(media.thumbnail_path);
        for (const column of ['media_path', 'thumbnail_path'] as const) {
          await this.storage.deleteFilesByPrefix(
            buildDerivedPrefix({
              kind: 'resized-image',
              table: 'dish_media',
              column,
              recordId: media.id,
            }),
          );
          await this.storage.deleteFilesByPrefix(
            buildDerivedPrefix({
              kind: 'transcoded-video',
              table: 'dish_media',
              column,
              recordId: media.id,
            }),
          );
        }
      }
    } catch (err) {
      this.logger.error(
        'DeleteMeStorageCleanupFailed',
        'deleteStorageObjectsForUser',
        { userId, error_message: (err as Error).message },
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /*          GET /v1/users/me/blocked-dish-categories                 */
  /* ------------------------------------------------------------------ */
  async getMeBlockedDishCategories(
    userId: string,
    dto: QueryMeBlockedDishCategoriesDto,
  ) {
    this.logger.debug(
      'GetMeBlockedDishCategories',
      'getMeBlockedDishCategories',
      {
        userId,
        cursor: dto.cursor,
      },
    );

    const { items: categoryIds, nextCursor } =
      await this.repo.findBlockedDishCategories(userId, dto.cursor);

    if (categoryIds.length === 0) {
      this.logger.debug(
        'GetMeBlockedDishCategoriesResult',
        'getMeBlockedDishCategories',
        {
          count: 0,
          nextCursor: null,
        },
      );
      return {
        data: [],
        nextCursor: null,
      };
    }

    const records =
      await this.dishCategoriesRepo.findDishCategoriesByIds(categoryIds);

    // IN 検索結果の順序は categoryIds と一致しないため、フロント無限スクロール用に ID 順で並べ替える
    const recordMap = new Map(records.map((record) => [record.id, record]));
    const orderedRecords = categoryIds
      .map((id) => recordMap.get(id))
      .filter((record) => record != null);

    this.logger.debug(
      'GetMeBlockedDishCategoriesResult',
      'getMeBlockedDishCategories',
      {
        count: orderedRecords.length,
        nextCursor,
      },
    );

    return {
      data: orderedRecords,
      nextCursor,
    };
  }

  /* ------------------------------------------------------------------ */
  /*     DELETE /v1/users/me/blocked-dish-categories/:categoryId       */
  /* ------------------------------------------------------------------ */
  async unblockDishCategory(userId: string, categoryId: string) {
    this.logger.debug('UnblockDishCategory', 'unblockDishCategory', {
      userId,
      categoryId,
    });

    const success = await this.repo.unblockDishCategory(userId, categoryId);

    this.logger.debug('UnblockDishCategoryResult', 'unblockDishCategory', {
      success,
    });

    return {
      success,
      message: success ? 'Category unblocked successfully' : 'No block found',
    };
  }
}
