// api/src/v1/users/users.repository.ts
//
// Repository for users data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaUsers } from '../../../../shared/converters/convert_users';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import type { ReadableRestaurant } from '../restaurants/restaurants.repository';
import { Prisma } from '../../../../shared/prisma/client';
import { QueryMyDishesDto, MyDishStatus } from '@shared/v1/dto';
import { MY_DISH_MAP_PINS_LIMIT } from '@shared/v1/res';
import { roundToOneDecimal } from '../../core/utils/backend-utils';
import {
  MyDishCursor,
  buildMyDishMapPinsQuery,
  buildMyDishesOldestWantSaveQuery,
  buildMyDishesPageQuery,
} from './my-dishes.query';
import {
  buildCursorFilter,
  buildCursorOrderBy,
  formatCompositeCursor,
} from '../../core/pagination/composite-cursor';

/** #1395 一覧 1 行ぶんの生データ（DishMediaEntry の組み立ては Service 側で行う） */
export type MyDishRowEntity = {
  key: string;
  status: MyDishStatus;
  occurredAt: Date;
  savedAt: Date | null;
  eatenAt: Date | null;
  reviewId: string | null;
  /** 代表メディア（#1395 m-7 の規則で解決済み）。写真なし記録では null */
  mediaId: string | null;
  /**
   * #1513 自分の投稿（own_media_id が指すメディア）が論理削除済みか。
   *
   * true のとき `mediaId` は必ず null になる（削除済みメディアを別の写真へ
   * 差し替えないため）。行は消さないので、UI 側が墓標を出すのに使う。
   */
  isOwnMediaDeleted: boolean;
  distanceMeters: number | null;
  restaurant: ReadableRestaurant;
  dish: PrismaDishes & {
    reviewCount: number;
    averageRating: number;
    /** #1398 PR1: `dish_categories.image_url`（NOT NULL）。写真なし行のフォールバック画像に使う */
    categoryImageUrl: string;
    /** #1375 dish_categories.labels（言語コード → 表記）。ローマ字の dish.name を見せないために使う */
    categoryLabels: Record<string, string> | null;
  };
  /** カーソル生成用（sort ごとに必要な要素だけ使う） */
  cursorSource: {
    row_key: string;
    occurred_at: Date;
    rating: number | null;
    distance_meters: number | null;
    feature_score: number | null;
  };
};

/** #1395 Map ピン 1 件ぶんの生データ */
export type MyDishPinEntity = {
  restaurant: ReadableRestaurant;
  counts: { want: number; eaten: number };
  latestOccurredAt: Date;
  /** 代表メディアのサムネイル組み立てに必要な最小限の列 */
  representativeMedia: {
    id: string;
    thumbnail_path: string;
    thumbnail_processing_status: string;
  } | null;
  /**
   * #1375 G4 SNS 取り込みの provider 側サムネイル URL。
   *
   * 取り込み行は自ストレージへの複製に失敗し得る（`replicateExternalThumbnail` は
   * 失敗しても縮退する設計）ため、`representativeMedia` が null になる正常系がある。
   * 一覧 / Feed は assembler がここへ落ちるので、Map ピンも同じ順序で落とす。
   */
  representativeExternalThumbnailUrl: string | null;
  /**
   * #1513 ピンの代表行が指す自分のメディアが論理削除済みか。
   *
   * true のとき `representativeMedia` は null になる（別の写真へ差し替えないため）。
   * ピンは消さないので、UI 側が墓標のサムネイルを出すのに使う。
   */
  isOwnMediaDeleted: boolean;
};

type RestaurantColumns = {
  r_id: string;
  r_google_place_id: string;
  r_name: string;
  r_name_language_code: string;
  r_latitude: number;
  r_longitude: number;
  r_image_path: string | null;
  r_address_components: Prisma.JsonValue;
  r_created_at: Date;
};

type DishColumns = {
  d_id: string;
  d_restaurant_id: string;
  d_category_id: string;
  d_name: string | null;
  d_created_at: Date;
  d_updated_at: Date;
  d_lock_no: number;
  d_category_image_url: string;
  d_category_labels: Record<string, string> | null;
};

type MyDishRawRow = RestaurantColumns &
  DishColumns & {
    row_key: string;
    row_status: MyDishStatus;
    review_id: string | null;
    dish_id: string;
    occurred_at: Date;
    saved_at: Date | null;
    rating: number | null;
    distance_meters: number | null;
    feature_score: number | null;
    media_id: string | null;
    /** #1513 own_media_id は非 NULL だが実体が論理削除済み（墓標を出す行） */
    is_own_media_deleted: boolean;
    review_count: number;
    average_rating: number;
  };

type MyDishPinRawRow = RestaurantColumns & {
  want_count: number;
  eaten_count: number;
  latest_occurred_at: Date;
  media_id: string | null;
  media_thumbnail_path: string | null;
  media_thumbnail_processing_status: string | null;
  /** #1375 G4 SNS 取り込みの provider 側サムネイル（自ストレージへの複製が無い行の退避先） */
  media_external_thumbnail_url: string | null;
  /** #1513 代表行の own_media_id は非 NULL だが実体が論理削除済み */
  is_own_media_deleted: boolean;
};

/*
#843 で `restaurants` / `dishes` に «推薦カタログの同期メタ» が増えた。
この画面はどれも使わないが、`ReadableRestaurant` / `PrismaDishes` を満たす必要がある。

**SQL で引かずに既定値で埋める。** 使わない列のために毎ページ 4 列を余計に読むのは
無駄で、ここは 964MB の dish_reviews を含む経路である（#1395 B-2 の判断と同じ）。
返り値がそのままクライアントへ出るわけではなく、`RestaurantsEntity` へ畳まれる際に
落ちるので、既定値で埋めても API の応答は変わらない。
*/
// #1779 落とす列（image_url / plus_code）は SELECT もしないし、既定値でも埋めない。
// `ReadableRestaurant` はその 2 列を外した形なので、そのまま満たせる。
const toRestaurant = (row: RestaurantColumns): ReadableRestaurant => ({
  source_seed_id: null,
  source_names: [],
  source_row_hash: null,
  synced_at: null,
  // #843 ここは SELECT していないので **実際の値ではない**。上の理由で列を増やさず、
  // 型を満たすためだけに DB 既定値と同じ 'user' を置いている。
  // `RestaurantsEntity` へ畳まれる際に落ちるのでクライアントへは出ない。
  // **この値を見て分岐するコードを書かないこと。**
  created_by_source: 'user',
  // #1681 同じ理由で SELECT していない。`RestaurantsEntity` へ畳まれる際に落ちる。
  address: null,
  country_code: null,
  // #1671 同上。ここは «その店の言語» を決めないので、引く必要が無い
  subterritory_code: null,
  id: row.r_id,
  google_place_id: row.r_google_place_id,
  name: row.r_name,
  name_language_code: row.r_name_language_code,
  latitude: row.r_latitude,
  longitude: row.r_longitude,
  image_path: row.r_image_path,
  address_components: row.r_address_components,
  created_at: row.r_created_at,
});

@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ================================================================== */
  /*                       #1395 my-dishes                              */
  /* ================================================================== */
  //
  // SQL の組み立ては ./my-dishes.query.ts（PrismaService に依存しない純関数）に置き、
  // ここは実行と行のマッピングだけを持つ。Blocker だった keyset / LIMIT 押し込みを
  // DB 無しで単体テストできるようにするためである。

  /**
   * #1395 GET /v1/users/me/dishes の本体。
   *
   * `limit + 1` 件取って `hasMore` を判定する既存の作法に合わせる。
   * `dish.reviewCount` / `averageRating` と代表メディアのフォールバックは
   * **LIMIT を掛けた後のページ内 dish に限定した LATERAL** で取る（m-5）。
   * 候補集合全体への `GROUP BY` は B-2 と同じ事故になる。
   */
  async findMyDishes(
    userId: string,
    dto: QueryMyDishesDto,
    cursor: MyDishCursor | null,
  ): Promise<{ items: MyDishRowEntity[]; hasMore: boolean }> {
    const limit = dto.limit ?? 42;

    this.logger.debug('FindMyDishes', 'findMyDishes', {
      userId,
      sort: dto.sort ?? '-occurredAt',
      limit,
      status: dto.status,
      hasCursor: cursor !== null,
    });

    const query = buildMyDishesPageQuery(userId, dto, cursor);
    if (!query) return { items: [], hasMore: false };

    const rows = await this.prisma.prisma.$queryRaw<MyDishRawRow[]>(query);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    this.logger.debug('FindMyDishesResult', 'findMyDishes', {
      count: page.length,
      hasMore,
    });

    return {
      items: page.map((row) => ({
        key: row.row_key,
        status: row.row_status,
        occurredAt: row.occurred_at,
        savedAt: row.saved_at,
        eatenAt: row.row_status === 'eaten' ? row.occurred_at : null,
        reviewId: row.review_id,
        mediaId: row.media_id,
        isOwnMediaDeleted: row.is_own_media_deleted === true,
        distanceMeters: row.distance_meters,
        restaurant: toRestaurant(row),
        dish: {
          // #843 の同期メタ。この画面では使わないが型を満たす必要がある
          // （SQL で引かない理由は toRestaurant の申し送りと同じ）
          data_origin: 'user_or_google',
          synced_at: null,
          id: row.d_id,
          restaurant_id: row.d_restaurant_id,
          category_id: row.d_category_id,
          name: row.d_name,
          created_at: row.d_created_at,
          updated_at: row.d_updated_at,
          lock_no: row.d_lock_no,
          reviewCount: row.review_count,
          averageRating: roundToOneDecimal(row.average_rating),
          categoryImageUrl: row.d_category_image_url,
          categoryLabels: row.d_category_labels ?? null,
        },
        cursorSource: {
          row_key: row.row_key,
          occurred_at: row.occurred_at,
          rating: row.rating,
          distance_meters: row.distance_meters,
          feature_score: row.feature_score,
        },
      })),
      hasMore,
    };
  }

  /**
   * #1395 GET /v1/users/me/dishes/map-pins の本体。
   *
   * Map は「viewport 内のピンを全部」欲しいのでページングしない。
   * 代わりに `MY_DISH_MAP_PINS_LIMIT` で打ち切り、**切られたことを呼び出し元へ返す**。
   * 黙って切らない。
   */
  async findMyDishMapPins(
    userId: string,
    dto: QueryMyDishesDto,
  ): Promise<{ items: MyDishPinEntity[]; truncated: boolean }> {
    this.logger.debug('FindMyDishMapPins', 'findMyDishMapPins', {
      userId,
      status: dto.status,
      hasArea: dto.lat !== undefined,
    });

    const query = buildMyDishMapPinsQuery(userId, dto);
    if (!query) return { items: [], truncated: false };

    const rows = await this.prisma.prisma.$queryRaw<MyDishPinRawRow[]>(query);

    const truncated = rows.length > MY_DISH_MAP_PINS_LIMIT;
    const pins = truncated ? rows.slice(0, MY_DISH_MAP_PINS_LIMIT) : rows;

    this.logger.debug('FindMyDishMapPinsResult', 'findMyDishMapPins', {
      count: pins.length,
      truncated,
    });

    return {
      items: pins.map((row) => ({
        restaurant: toRestaurant(row),
        counts: { want: row.want_count, eaten: row.eaten_count },
        latestOccurredAt: row.latest_occurred_at,
        representativeMedia:
          row.media_id && row.media_thumbnail_path
            ? {
                id: row.media_id,
                thumbnail_path: row.media_thumbnail_path,
                thumbnail_processing_status:
                  row.media_thumbnail_processing_status ?? 'idle',
              }
            : null,
        // #1375 G4 自ストレージへの複製が無い（= thumbnail_path が空）取り込み行のための退避先
        representativeExternalThumbnailUrl:
          row.media_external_thumbnail_url ?? null,
        isOwnMediaDeleted: row.is_own_media_deleted === true,
      })),
      truncated,
    };
  }

  /**
   * #1395 Calendar が「どこまで遡れるか」を知るための最古 `occurredAt`。
   *
   * **`status` 以外のフィルタが無いときだけ**算出する。
   * その条件下では、両枝とも索引の先頭 1 行を読むだけで済む
   * （`idx_dish_reviews_user_created_at` / `idx_reactions_profile_cursor`）。
   * カテゴリ・エリア・評価・期間が付くと索引で順序を保てず、
   * `dish_reviews`（約 964MB）に対するユーザー全行走査が
   * **フィルタを変えるたびに** 1 回走ってしまうため、その場合は算出しない（B-2）。
   *
   * want 側だけは「もう食べた dish の save」を除くため `reactions` を 1 度舐める（m-b）。
   */
  async findMyDishesOldestOccurredAt(
    userId: string,
    statuses: MyDishStatus[],
  ): Promise<Date | null> {
    // eaten / want の 2 本は独立なので並列に引く（片方だけのときは 1 本）
    const [oldestReview, oldestSaveRows] = await Promise.all([
      statuses.includes('eaten')
        ? this.prisma.prisma.dish_reviews.findFirst({
            // #1513 一覧の eaten 枝と同じ条件で引く。削除済みを混ぜると
            // 「一覧に 1 件も無い月まで Calendar が遡れる」表示になる
            where: { user_id: userId, deleted_at: null },
            orderBy: { created_at: 'asc' },
            select: { created_at: true },
          })
        : Promise.resolve(null),
      // #1395 m-b / m-e: 一覧の want 行は「その dish に自分の dish_reviews が 1 件も無い」
      // ものだけ（NOT EXISTS）で、`occurredAt` は dish ごとの「最新 save」
      // （DISTINCT ON ... ORDER BY created_at DESC）。ここも dish ごとに畳んでから
      // MIN を取らないと、一覧に出ない月まで Calendar が遡れると表示してしまう。
      // SQL の形は my-dishes.query.ts（PrismaService に依存しない純関数）に置き、
      // DB 無しで単体テストできるようにしている。
      //
      // フェンスがあるので save 全件を 1 度読むが、この算出は
      // 「初回ページかつ status 以外のフィルタ無し」のときだけ走る（resolveOldestOccurredAt）。
      statuses.includes('want')
        ? this.prisma.prisma.$queryRaw<{ oldest: Date | null }[]>(
            buildMyDishesOldestWantSaveQuery(userId),
          )
        : Promise.resolve([] as { oldest: Date | null }[]),
    ]);

    const candidates: Date[] = [];
    if (oldestReview) candidates.push(oldestReview.created_at);
    const oldestSave = oldestSaveRows[0]?.oldest ?? null;
    if (oldestSave) candidates.push(oldestSave);

    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a < b ? a : b));
  }

  /**
   * ユーザーの収益一覧を取得
   */
  async findUserPayouts(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.payouts.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
    this.logger.debug('FindUserPayouts', 'findUserPayouts', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    // #1599 `(created_at, id)` の複合カーソル。時刻単独だと同時刻の行がページ境界で飛ぶ
    Object.assign(whereClause, buildCursorFilter(cursor));

    const result = await this.prisma.prisma.payouts.findMany({
      where: whereClause,
      orderBy: buildCursorOrderBy(),
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? formatCompositeCursor(
            items[items.length - 1].created_at,
            items[items.length - 1].id,
          )
        : null;

    this.logger.debug('UserPayoutsFound', 'findUserPayouts', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * ユーザーの入札履歴を取得
   */
  async findUserRestaurantBids(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.restaurant_bids.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
    this.logger.debug('FindUserRestaurantBids', 'findUserRestaurantBids', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    // #1599 `(created_at, id)` の複合カーソル。時刻単独だと同時刻の行がページ境界で飛ぶ
    Object.assign(whereClause, buildCursorFilter(cursor));

    const result = await this.prisma.prisma.restaurant_bids.findMany({
      where: whereClause,
      orderBy: buildCursorOrderBy(),
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? formatCompositeCursor(
            items[items.length - 1].created_at,
            items[items.length - 1].id,
          )
        : null;

    this.logger.debug('UserRestaurantBidsFound', 'findUserRestaurantBids', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * 指定されたIDのユーザーを取得
   *
   * #1511 削除済み（deleted_at IS NOT NULL）のユーザーは返さない。
   * 通知の actor 表示・push 文面の組み立てがここを通るため、
   * 退会したユーザーの表示名が他人の画面に出続けるのを構造的に塞ぐ。
   * 呼び出し側は「引けない actor がありうる」前提で書くこと。
   */
  async getUserByIds(userId: string[]) {
    return this.prisma.prisma.users.findMany({
      where: {
        id: { in: userId },
        deleted_at: null,
      },
    });
  }

  /**
   * 指定されたIDのユーザーを1件取得
   *
   * #1511 削除済みユーザーは「存在しない」として null を返す
   * （`findUnique` では複合条件を書けないため `findFirst` を使う）。
   * これにより `GET /v1/users/:id` は退会後 404 になり、
   * `POST /v1/users/me` の前段チェックも同時に塞がる。
   */
  async getUserById(userId: string) {
    return this.prisma.prisma.users.findFirst({
      where: { id: userId, deleted_at: null },
    });
  }

  /**
   * #1511 削除処理のためだけの取得。**deleted_at を無視して**行を引く。
   *
   * 削除は冪等でなければならない（DB の匿名化まで済んで auth 削除で落ちた、という
   * 状態から再実行で完了できること）。`getUserById` は削除済みを隠すので、
   * 再実行時に「ユーザーが居ない」と誤判定してしまう。ここだけは素の行を見る。
   */
  async getUserByIdIncludingDeleted(userId: string) {
    return this.prisma.prisma.users.findUnique({
      where: { id: userId },
    });
  }

  /**
   * #1511 / #1557 «退会した» と «そもそも users 行が無い» を呼び出し側が
   * 区別できるようにするための取得。**deleted_at を無視して**引く。
   *
   * 通知の生成では、この 2 つを混同してはいけない。
   * - 退会（行があり deleted_at IS NOT NULL）… 通知を作らない
   * - 匿名（行そのものが無い）… #1557 の共有リンク経由の投票者。通知は作る
   *
   * `getUserByIds` は前者も後者も「引けない」で潰してしまうので、
   * 退会だけを弾きたい場所ではこちらを使うこと。
   */
  async getUsersByIdsIncludingDeleted(userIds: string[]) {
    return this.prisma.prisma.users.findMany({
      where: { id: { in: userIds } },
    });
  }

  /**
   * ユーザープロフィールを更新
   */
  async updateUserProfile(
    data: Partial<Omit<PrismaUsers, 'created_at' | 'updated_at' | 'lock_no'>>,
  ) {
    const result = await this.prisma.prisma.users.update({
      where: { id: data.id },
      data: {
        ...data,
        updated_at: new Date(),
        lock_no: { increment: 1 },
      },
    });
    return result;
  }

  /**
   * ブロック中の料理カテゴリを取得
   */
  async findBlockedDishCategories(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: string[]; // dish_categories IDs
    nextCursor: string | null;
  }> {
    this.logger.debug(
      'FindBlockedDishCategories',
      'findBlockedDishCategories',
      {
        userId,
        cursor,
        limit,
      },
    );

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_categories',
      action_type: 'block',
    };

    // #1599 `(created_at, id)` の複合カーソル。時刻単独だと同時刻の行がページ境界で飛ぶ
    Object.assign(whereClause, buildCursorFilter(cursor));

    const result = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: buildCursorOrderBy(),
      take: limit + 1,
      select: {
        // #1599 複合カーソルの第 2 キーに使うので id も引く
        id: true,
        target_id: true,
        created_at: true,
      },
    });

    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? formatCompositeCursor(
            items[items.length - 1].created_at,
            items[items.length - 1].id,
          )
        : null;

    this.logger.debug(
      'BlockedDishCategoriesFound',
      'findBlockedDishCategories',
      {
        count: items.length,
        hasMore,
      },
    );

    return { items: items.map((r) => r.target_id), nextCursor };
  }

  /**
   * 料理カテゴリのブロックを解除
   */
  async unblockDishCategory(
    userId: string,
    categoryId: string,
  ): Promise<boolean> {
    this.logger.debug('UnblockDishCategory', 'unblockDishCategory', {
      userId,
      categoryId,
    });

    const result = await this.prisma.prisma.reactions.deleteMany({
      where: {
        user_id: userId,
        target_type: 'dish_categories',
        target_id: categoryId,
        action_type: 'block',
      },
    });

    this.logger.debug('UnblockDishCategoryResult', 'unblockDishCategory', {
      count: result.count,
    });

    return result.count > 0;
  }

  /* ------------------------------------------------------------------ */
  /*                    DELETE /v1/users/me（#1511）                    */
  /* ------------------------------------------------------------------ */
  /**
   * アカウント削除のアプリ DB 側を **1 トランザクション**で行う。
   *
   * ## ここでやること（リーダー判断 #1511 の表に対応）
   * 1. `users` 行を残したまま PII を匿名化し `deleted_at` を立てる
   *    - `username` は citext unique なので `deleted_<id>` へ置換して名前を解放する
   *    - `display_name` / `bio` / `avatar_path` を NULL 化する
   * 2. 本人の行動そのもの（いいね・リアクション・端末トークン・既読位置・権限・受信箱）を物理削除
   * 3. 2 で消したいいねの分だけ `dish_media_analysis_results.like_total` を **実数で引き直す**
   *
   * ## ここでやらないこと
   * - `dish_media` / `dish_reviews` は **行も user_id も触らない**。
   *   投稿・レビューの論理削除は「作者の `users.deleted_at`」で表現し、読み取り経路が
   *   `users` を準結合して落とす（dish-media.repository.ts）。user_id を NULL にすると
   *   作者を辿れなくなり、この判定自体ができなくなる。
   * - `restaurant_bids` / `payouts` は金銭記録なので保持する。
   * - 行動ログ（`*_event_logs` / impressions / views）は保持する（BigQuery にも複製があり、
   *   アプリ DB だけ消しても「消えた」ことにならない。保持する旨をプライバシーポリシーに明記した）。
   *
   * ## 冪等性
   * すべて `updateMany` / `deleteMany` と「現在値の再計算」で書いており、
   * 2 回目以降の実行は 0 件更新になるだけで壊れない。`username` の置換先は id から
   * 決まるので、再実行しても同じ値に落ち着く。
   *
   * @returns 匿名化・削除した件数の内訳（監査ログ用）
   */
  async softDeleteUserAccount(userId: string): Promise<{
    deletedAt: Date;
    likesDeleted: number;
    reactionsDeleted: number;
    deviceTokensDeleted: number;
    notificationCursorsDeleted: number;
    notificationRecipientsDeleted: number;
    rolesDeleted: number;
    likeTotalsRecalculated: number;
  }> {
    this.logger.debug('SoftDeleteUserAccount', 'softDeleteUserAccount', {
      userId,
    });

    return this.prisma.withTransaction(async (tx) => {
      const deletedAt = new Date();

      // ── 1. いいねを消す前に、影響を受ける dish_media を控える ──────────
      // 先に消してしまうと「どの投稿の like_total を引き直すか」が分からなくなる
      const affectedLikes = await tx.dish_media_likes.findMany({
        where: { user_id: userId },
        select: { dish_media_id: true },
      });
      const affectedDishMediaIds = Array.from(
        new Set(affectedLikes.map((l) => l.dish_media_id)),
      );

      const likes = await tx.dish_media_likes.deleteMany({
        where: { user_id: userId },
      });

      // ── 2. 本人の行動データを物理削除する ─────────────────────────
      // reactions は「保存 / ブロック / いいね」等の個人の嗜好そのもの。
      // ⚠️ 他人のリアクションには触らない（`user_id = 本人` で必ず絞る）
      const reactions = await tx.reactions.deleteMany({
        where: { user_id: userId },
      });
      // プッシュ通知を確実に止める
      const deviceTokens = await tx.user_device_tokens.deleteMany({
        where: { user_id: userId },
      });
      const notificationCursors = await tx.user_notification_cursors.deleteMany(
        { where: { user_id: userId } },
      );
      // 本人の受信箱。notifications 本体（他人にも配られている）は消さない
      const notificationRecipients =
        await tx.notification_recipients.deleteMany({
          where: { recipient_id: userId },
        });
      // 権限の剥奪（PermissionGuard は user_roles を見る）
      const roles = await tx.user_roles.deleteMany({
        where: { user_id: userId },
      });

      // ── 3. like_total を実数で引き直す ───────────────────────────
      // #1511 いいねを物理削除すると集計のトゥルース源 `like_total` とズレる。
      // 減算（`decrement`）ではなく **現在の実数を数え直す**のは、削除処理が
      // 再実行されても二重に引かれないようにするため（冪等性）。
      //
      // #1599 【バグ】ここは対象 1 件ごとに `count` + `updateMany` の 2 クエリを
      // 直列に投げるループだった。`affectedDishMediaIds` は **そのユーザーが
      // いいねした dish_media の数**で上限が無く、しかも全部が 1 つの
      // `withTransaction`（PRISMA_TX_TIMEOUT の既定は 60 秒）の中で走る。
      //
      // 3,000 件いいねしていれば 6,000 クエリになり、**よく使っていた人ほど
      // 退会に失敗する**。しかも失敗の仕方が決定的なので、再実行しても同じところで
      // 落ち続ける（利用規約は「いつでも削除できる」と約束している）。
      //
      // 1 文の集合演算に置き換える。件数に関係なくクエリは 1 本。
      // 冪等性（実数で数え直す）はそのまま保たれる。
      //
      // ⚠️ SQL 側の `SELECT DISTINCT` は **上の `new Set` があるから冗長、ではない**。
      // 同じ id が配列に 2 回入ると `UNNEST` はその id の行を 2 行返し、
      // `LEFT JOIN` がいいね 1 件につき 2 行に増え、`COUNT` が **2 倍の値**になる。
      // like_total は表示される数字なので、静かに倍になる壊れ方をする。
      // 「呼び出し側が必ず重複を除いている」に依存させない（片方を消したら壊れる形にしない）。
      const likeTotalsRecalculated =
        affectedDishMediaIds.length === 0
          ? 0
          : (
              await tx.$queryRaw<{ dish_media_id: string }[]>`
                UPDATE dish_media_analysis_results AS a
                   SET like_total = c.cnt,
                       updated_at = NOW()
                  FROM (
                        SELECT m.id AS dish_media_id,
                               COUNT(l.dish_media_id)::int AS cnt
                          FROM (SELECT DISTINCT id
                                  FROM UNNEST(${affectedDishMediaIds}::uuid[]) AS u(id)) AS m
                          LEFT JOIN dish_media_likes l
                                 ON l.dish_media_id = m.id
                         GROUP BY m.id
                       ) AS c
                 WHERE a.dish_media_id = c.dish_media_id
                RETURNING a.dish_media_id
              `
            ).length;

      // ── 4. users 行の匿名化 + deleted_at ────────────────────────
      // ⚠️ `updateMany` にしているのは冪等性のため。既に削除済みでも 0 件更新で通る。
      await tx.users.updateMany({
        where: { id: userId },
        data: {
          username: `deleted_${userId}`,
          display_name: null,
          bio: null,
          avatar_path: null,
          deleted_at: deletedAt,
          updated_at: deletedAt,
          lock_no: { increment: 1 },
        },
      });

      this.logger.log('SoftDeleteUserAccountDone', 'softDeleteUserAccount', {
        userId,
        likesDeleted: likes.count,
        reactionsDeleted: reactions.count,
        deviceTokensDeleted: deviceTokens.count,
        notificationCursorsDeleted: notificationCursors.count,
        notificationRecipientsDeleted: notificationRecipients.count,
        rolesDeleted: roles.count,
        likeTotalsRecalculated,
      });

      return {
        deletedAt,
        likesDeleted: likes.count,
        reactionsDeleted: reactions.count,
        deviceTokensDeleted: deviceTokens.count,
        notificationCursorsDeleted: notificationCursors.count,
        notificationRecipientsDeleted: notificationRecipients.count,
        rolesDeleted: roles.count,
        likeTotalsRecalculated,
      };
    });
  }

  /**
   * #1511 削除対象ユーザーが投稿した dish_media のメディアパスを引く。
   *
   * GCS の実体を消すために使う。**論理削除なので行は残す**が、
   * 「参照が消えたあとに実体を残す理由がない」（リーダー判断）ため、
   * 画像・動画のオブジェクトは削除する。
   */
  async findDishMediaPathsByUser(userId: string) {
    return this.prisma.prisma.dish_media.findMany({
      where: { user_id: userId },
      select: { id: true, media_path: true, thumbnail_path: true },
    });
  }
}
