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
  QueryMyDishesDto,
  MyDishSort,
  MyDishStatus,
  QueryMeDishCategoryGroupVotesDto,
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
import {
  DishMediaEntry,
  MyDishItem,
  QueryMeDishMapPinsResponse,
  QueryMyDishesResponse,
  MeDishCategoryGroupVoteListItem,
} from '@shared/v1/res';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { RestaurantsAssembler } from '../restaurants/restaurants.assembler';
import { DishMediaAssembler } from '../dish-media/dish-media.assembler';
import { toNullableId } from '../../core/utils/backend-utils';
import {
  decodeMyDishCursor,
  encodeMyDishCursor,
  hasMyDishesFilterBeyondStatus,
} from './my-dishes.query';
import { DishCategoryGroupVotesRepository } from '../dish-category-group-votes/dish-category-group-votes.repository';
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
    private readonly restaurantsAssembler: RestaurantsAssembler,
    private readonly dishMediaAssembler: DishMediaAssembler,
    private readonly dishCategoryGroupVotesRepo: DishCategoryGroupVotesRepository,
    private readonly prismaService: PrismaService,
    private readonly storage: StorageService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async getUserByIds(userId: string[]) {
    return this.repo.getUserByIds(userId);
  }

  /**
   * #1511 / #1557 退会と匿名（users 行なし）を区別したい呼び出し側のための取得。
   * 詳細は `UsersRepository.getUsersByIdsIncludingDeleted` の JSDoc を参照。
   */
  async getUsersByIdsIncludingDeleted(userIds: string[]) {
    return this.repo.getUsersByIdsIncludingDeleted(userIds);
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

    // #1395 写真なしの「食べた」記録では created_dish_media_id が NULL になる。
    // ここで単純に Map を引くと、その行が **警告ログだけ残して黙って消える**。
    // 代表メディアの選び方を my-dishes と揃え、「その dish の最新メディア」へ落とす。
    // それでもメディアが 1 件も無い dish は、このエンドポイントの型
    // （DishMediaEntry = メディア 1 件が主語）では表現できないため返せない。
    // 写真なし記録を落とさずに見せるのは GET /v1/users/me/dishes?status=eaten の役目である。
    const reviewsWithoutMedia = reviews.filter(
      (r) => toNullableId(r.created_dish_media_id) === null,
    );
    const fallbackMediaIdByDishId =
      await this.dishMediaRepo.findLatestDishMediaIdsByDishIds(
        Array.from(new Set(reviewsWithoutMedia.map((r) => r.dish_id))),
      );

    const resolveMediaId = (review: (typeof reviews)[number]): string | null =>
      toNullableId(review.created_dish_media_id) ??
      fallbackMediaIdByDishId.get(review.dish_id) ??
      null;

    const uniqueDishMediaIds = Array.from(
      // #1395 created_dish_media_id は nullable（メディアを作っていないレビュー）。
      // #1398 その場合は同じ dish の最新 dish_media を代表に立てる（resolveMediaId）
      new Set(
        reviews
          .map((r) => resolveMediaId(r))
          .filter((id): id is string => id !== null),
      ),
    );
    const dishMediaEntryItemsResult =
      await this.dishMediaService.fetchDishMediaEntryItems(uniqueDishMediaIds, {
        userId,
        // #1513 墓標「削除されました」を出す画面。行を消さずに中身だけ差し替えるため、
        // 削除済みの dish_media も受け取る（詳細は getDishMediaEntriesByIds の JSDoc）
        includeDeleted: true,
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
      withoutMedia: reviewsWithoutMedia.length,
    });

    return {
      data: reviews
        .map((review) => {
          // #1395 メディアを作っていないレビューには紐づく dish_media が無い（#1398 で代表を解決する）
          const mediaId = resolveMediaId(review);
          const dishMediaEntryItem =
            mediaId === null ? undefined : dishMediaMap.get(mediaId);
          if (!dishMediaEntryItem) {
            this.logger.warn(
              'DishMediaEntryItem not found for review',
              'getUserDishReviews',
              {
                reviewId: review.id,
                dishId: review.dish_id,
                dishMediaId: mediaId,
                // #1395 写真なし記録かつ dish にメディアが 1 件も無い場合はここに来る。
                // GET /v1/users/me/dishes?status=eaten へ移行すれば落ちなくなる
                reason:
                  mediaId === null ? 'no_media_for_dish' : 'media_not_fetched',
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
        // #1513 墓標「削除されました」を出す画面。行を消さずに中身だけ差し替えるため、
        // 削除済みの dish_media も受け取る（詳細は getDishMediaEntriesByIds の JSDoc）
        includeDeleted: true,
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
        // #1513 墓標「削除されました」を出す画面。行を消さずに中身だけ差し替えるため、
        // 削除済みの dish_media も受け取る（詳細は getDishMediaEntriesByIds の JSDoc）
        includeDeleted: true,
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
  /*          GET /v1/users/me/dish-category-group-votes               */
  /* ------------------------------------------------------------------ */
  // #1505 【設計】**自分が主催(作成)した** dish_category グループ投票の一覧。
  // 参加しただけのセッションは含まない(オーナー指示)。
  // 認可の担保は repository の where 句(host_user_id = 自分)に閉じており、
  // ここでは userId を JWT 由来のものだけ使い、body/query から session の所有者を受け取らない。
  async getMeDishCategoryGroupVotes(
    userId: string,
    dto: QueryMeDishCategoryGroupVotesDto,
  ): Promise<{
    data: MeDishCategoryGroupVoteListItem[];
    nextCursor: string | null;
  }> {
    this.logger.debug(
      'GetMeDishCategoryGroupVotes',
      'getMeDishCategoryGroupVotes',
      {
        userId,
        cursor: dto.cursor,
      },
    );

    const { items, nextCursor } =
      await this.dishCategoryGroupVotesRepo.findMeSessions(
        this.prismaService.prisma,
        userId,
        dto.cursor,
      );

    this.logger.debug(
      'GetMeDishCategoryGroupVotesResult',
      'getMeDishCategoryGroupVotes',
      {
        count: items.length,
        nextCursor,
      },
    );

    return {
      data: items.map((item) => ({
        id: item.id,
        shareToken: item.shareToken,
        hasVoted: item.hasVoted,
        candidateCount: item.candidateCount,
        // #1505 行の主役は「何を投票したのか」。候補のサムネイル・候補名・参加人数・勝者名を
        // 一覧の時点で返し、画面が行ごとに detail を叩かなくて済むようにしている。
        candidatePreviews: item.candidatePreviews,
        participantCount: item.participantCount,
        winnerName: item.winnerName,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
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
  /*                    GET /v1/users/me/dishes                         */
  /* ------------------------------------------------------------------ */
  // #1395 「食べたい/食べた」の一覧（リスト / Calendar が共有する）
  async getMyDishes(
    userId: string,
    dto: QueryMyDishesDto,
  ): Promise<QueryMyDishesResponse> {
    const sort: MyDishSort = dto.sort ?? '-occurredAt';
    const cursor = dto.cursor ? decodeMyDishCursor(sort, dto.cursor) : null;

    this.logger.debug('GetMyDishes', 'getMyDishes', {
      userId,
      sort,
      status: dto.status,
      limit: dto.limit,
      hasCursor: cursor !== null,
    });

    const { items, hasMore } = await this.repo.findMyDishes(
      userId,
      dto,
      cursor,
    );

    // 代表メディアの詳細（署名 URL・isLiked 等）は既存の組み立て経路を再利用する
    const mediaIds = Array.from(
      new Set(
        items
          .map((item) => item.mediaId)
          .filter((id): id is string => id !== null),
      ),
    );
    // 自分のレビュー（★n はここから引く）
    const reviewIds = items
      .map((item) => item.reviewId)
      .filter((id): id is string => id !== null);

    // メディア詳細・自分のレビュー・最古日はいずれも互いの結果を使わないので
    // 並列に取る（直列だと応答時間が 3 本の合算になる。独立レビュー指摘）
    const [
      { items: dishMediaEntries },
      { items: myReviews },
      oldestOccurredAt,
    ] = await Promise.all([
      this.dishMediaService.fetchDishMediaEntryItems(mediaIds, { userId }),
      reviewIds.length
        ? this.dishMediaRepo.findDishReviewsByUser(userId, {
            type: 'ids',
            ids: reviewIds,
          })
        : Promise.resolve({
            items: [] as Awaited<
              ReturnType<typeof this.dishMediaRepo.findDishReviewsByUser>
            >['items'],
          }),
      this.resolveOldestOccurredAt(userId, dto),
    ]);
    const dishMediaById = new Map(
      dishMediaEntries.map((entry) => [entry.dish_media.id, entry.dish_media]),
    );
    const myReviewById = new Map(
      myReviews.map((review) => [review.id, review]),
    );

    const data: MyDishItem[] = items.map((item) => {
      const review = item.reviewId
        ? myReviewById.get(item.reviewId)
        : undefined;
      return {
        key: item.key,
        status: item.status,
        occurredAt: item.occurredAt.toISOString(),
        savedAt: item.savedAt ? item.savedAt.toISOString() : null,
        eatenAt: item.eatenAt ? item.eatenAt.toISOString() : null,
        restaurant: this.restaurantsAssembler.enrichRestaurantsWithImageUrls(
          item.restaurant,
        ),
        dish: {
          ...convertPrismaToSupabase_Dishes(item.dish),
          reviewCount: item.dish.reviewCount,
          averageRating: item.dish.averageRating,
          categoryImageUrl: item.dish.categoryImageUrl,
          // #1375 カテゴリの正式表記（ローマ字の dish.name をユーザーに見せないため）
          categoryLabels: item.dish.categoryLabels,
        },
        dishMedia:
          (item.mediaId ? dishMediaById.get(item.mediaId) : undefined) ?? null,
        // #1513 自分の投稿を消したときは別の写真へ差し替えず（mediaId は NULL）、
        // このフラグで墓標を出させる。行は消さない
        isOwnMediaDeleted: item.isOwnMediaDeleted,
        myReview: review
          ? {
              ...convertPrismaToSupabase_DishReviews(review),
              username: review.username,
              isLiked: review.isLiked,
              likeCount: review.likeCount,
            }
          : null,
        distanceMeters: item.distanceMeters,
      };
    });

    const nextCursor =
      hasMore && items.length > 0
        ? encodeMyDishCursor(sort, items[items.length - 1].cursorSource)
        : null;

    this.logger.debug('GetMyDishesResult', 'getMyDishes', {
      count: data.length,
      hasMore,
      oldestOccurredAt,
    });

    return { data, nextCursor, meta: { oldestOccurredAt } };
  }

  /**
   * #1395 Calendar 用の最古 `occurredAt`。
   *
   * **初回ページ（cursor 未指定）かつ status 以外のフィルタが無いときだけ**算出する。
   * フィルタが付くと索引で順序を保てず `dish_reviews`（約 964MB）のユーザー全行走査になり、
   * それが**フィルタを変えるたび**に走ってしまうため。
   * null のときクライアントは `nextCursor === null` による終端検出のみに頼る。
   */
  private async resolveOldestOccurredAt(
    userId: string,
    dto: QueryMyDishesDto,
  ): Promise<string | null> {
    if (dto.cursor || hasMyDishesFilterBeyondStatus(dto)) return null;

    const statuses: MyDishStatus[] = dto.status?.length
      ? dto.status
      : ['want', 'eaten'];
    const oldest = await this.repo.findMyDishesOldestOccurredAt(
      userId,
      statuses,
    );
    return oldest ? oldest.toISOString() : null;
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/dishes/map-pins                    */
  /* ------------------------------------------------------------------ */
  // #1395 Map ビュー。一覧と同じ QueryMyDishesDto を取り、投影だけが違う
  async getMyDishMapPins(
    userId: string,
    dto: QueryMyDishesDto,
  ): Promise<QueryMeDishMapPinsResponse> {
    this.logger.debug('GetMyDishMapPins', 'getMyDishMapPins', {
      userId,
      status: dto.status,
      hasArea: dto.lat !== undefined,
    });

    const { items, truncated } = await this.repo.findMyDishMapPins(userId, dto);

    this.logger.debug('GetMyDishMapPinsResult', 'getMyDishMapPins', {
      count: items.length,
      truncated,
    });

    return {
      data: items.map((pin) => ({
        restaurant: this.restaurantsAssembler.enrichRestaurantsWithImageUrls(
          pin.restaurant,
        ),
        counts: pin.counts,
        latestOccurredAt: pin.latestOccurredAt.toISOString(),
        // #1375 G4 一覧・Feed（dish-media.assembler.ts）と同じ順序で落とす:
        // 自ストレージのサムネイル → provider 側のサムネイル → null（店舗写真へ）
        representativeThumbnailUrl:
          (pin.representativeMedia
            ? this.dishMediaAssembler.getThumbnailImageUrl(
                pin.representativeMedia,
              )
            : null) ??
          pin.representativeExternalThumbnailUrl ??
          null,
        // #1513 代表行の自分の投稿が消えているときは墓標のサムネイルを出させる
        isOwnMediaDeleted: pin.isOwnMediaDeleted,
      })),
      truncated,
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
    dishMedias: { id: string; media_path: string | null; thumbnail_path: string }[],
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
        // #1395 で media_path は nullable になった（取り込み中で実体が未着の行）。
        // 派生（リサイズ・HLS）は recordId 基準で消すので、原本が無い行でも下の
        // deleteFilesByPrefix は回す必要がある
        if (media.media_path) {
          await this.storage.deleteFileIfExists(media.media_path);
        }
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
