// api/src/v1/dishes/dishes.repository.ts
//
// ❶ Prisma を使った DB アクセス層
// ❷ Service から呼ばれる具体的なクエリロジック
// ❸ トランザクション対応
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDishDto } from '@shared/v1/dto';
import { AppLoggerService } from 'src/core/logger/logger.service';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { google } from '@googlemaps/places/build/protos/protos';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';

export type ReusableGoogleImportDishMedia = {
  dishMediaId: string;
  reuseKind: 'completed' | 'google-import-non-completed';
};

@Injectable()
export class DishesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * レストランIDとカテゴリIDで料理を検索
   */
  async findDishByRestaurantAndCategory(
    restaurantId: string,
    categoryId: string,
  ) {
    return this.prisma.prisma.dishes.findFirst({
      where: {
        restaurant_id: restaurantId,
        category_id: categoryId,
      },
    });
  }

  /**
   * #514 既存 restaurant が今どの原本 path を指しているかだけを引く。
   *
   * handler が「古い path が壊れているか」を判定するためだけに使う。
   * 行が無ければ `null`（その場合は upsert の create 側で新しい path が入る）。
   */
  async findRestaurantImagePathByGooglePlaceId(
    google_place_id: string,
  ): Promise<{ image_path: string | null } | null> {
    return this.prisma.prisma.restaurants.findUnique({
      where: { google_place_id },
      select: { image_path: true },
    });
  }

  /**
   * レストランを作成または取得（Google Place データから）
   */
  async createOrGetRestaurant(
    tx: Prisma.TransactionClient,
    restaurant: Prisma.restaurantsCreateInput,
    google_place_id: string,
    options: { updateImagePath?: boolean } = {},
  ) {
    this.logger.debug('createOrGetRestaurant', 'DishesRepository', restaurant);
    const { id: _omitId, ...createData } = restaurant;

    return await tx.restaurants.upsert({
      where: { google_place_id },
      // #514 既存 restaurant が「もう GCS に無い古い path」を握ったままだと、
      // resize は 404 を繰り返し、画像は永久に表示されない。壊れていると
      // 判定できたときだけ、存在確認済みの新しい path へ貼り替える。
      // 判定は呼び出し元（非同期 handler）の責務で、`updateImagePath` に集約する。
      // 同期の先行 upsert は従来どおり no-op のままにする。
      update:
        options.updateImagePath && createData.image_path
          ? { image_path: createData.image_path }
          : {},
      create: createData,
    });
  }

  /**
   * カテゴリに基づいて料理を作成または取得
   */
  async createOrGetDishForCategory(
    tx: Prisma.TransactionClient,
    dish: {
      id?: string;
      restaurant_id: string;
      category_id: string;
      name: string | null;
      created_at?: Date;
      updated_at?: Date;
      lock_no?: number;
    },
  ) {
    // #1599 【バグ】ここは `findFirst` → 無ければ `create` という
    // TOCTOU（time-of-check to time-of-use）だった。dishes には
    // `@@unique([restaurant_id, category_id])`（dishes_restaurant_category_unique）が
    // 張ってあるため、同じ (restaurant_id, category_id) のリクエストが同時に来ると
    // 両方の findFirst が空振りし、後発の create が P2002 で落ちて 500 になる。
    //
    // ⚠️ **catch して読み直す方式は Postgres では成立しない。** ここは `tx`
    //    （$transaction 内）で動いており、P2002 が出た時点でトランザクション全体が
    //    aborted 状態になるので、同じ tx 内での後続クエリはすべて失敗する。
    //    **そもそも例外を出さない**必要がある。
    //
    // そこで `createMany({ skipDuplicates: true })`（= INSERT ... ON CONFLICT DO NOTHING）
    // を使う。競合しても例外にならず、トランザクションも生きたままになる。
    // 既に dish_reviews で採っているのと同じ手（createDishReviews 参照）。
    const where = {
      restaurant_id: dish.restaurant_id,
      category_id: dish.category_id,
    };

    const existing = await tx.dishes.findFirst({ where });

    if (existing) {
      return existing;
    }

    const { id: _omitId, ...createData } = dish;

    await tx.dishes.createMany({
      data: [createData],
      skipDuplicates: true,
    });

    // ON CONFLICT DO NOTHING は「自分が入れた」「他が入れた」を区別しないので、
    // どちらの場合も読み直して確定した行を返す。
    //
    // 【設計】READ COMMITTED（Postgres の既定 = Prisma $transaction の既定）を前提にしている。
    // 文ごとに新しいスナップショットを取るため、DO NOTHING が競合相手の commit を待った後の
    // この findFirst は、その行を必ず見られる。REPEATABLE READ 以上へ上げるとここが破れる。
    const persisted = await tx.dishes.findFirst({ where });

    if (!persisted) {
      throw new Error(
        `createOrGetDishForCategory: dish が見つからない (restaurant_id=${dish.restaurant_id}, category_id=${dish.category_id})`,
      );
    }

    return persisted;
  }

  /**
   * 料理メディアを作成（Google 写真から）
   */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dishMedia: PrismaDishMedia,
  ) {
    // #829 【バグ】未完了 Google import の再処理では同じ dish_media.id を再利用するため、retry で create すると主キー衝突する。
    return tx.dish_media.upsert({
      where: { id: dishMedia.id },
      update: {},
      create: dishMedia,
    });
  }

  /**
   * 料理レビューを作成（Google レビューから）
   */
  async createDishReviews(
    tx: Prisma.TransactionClient,
    reviews: PrismaDishReviews[],
  ) {
    // #829 【設計】既存 Google import の再処理では review payload も同じ ID になるため、Cloud Tasks retry は重複 insert ではなく no-op にする。
    return await tx.dish_reviews.createMany({
      data: reviews,
      skipDuplicates: true,
    });
  }

  /**
   * #829 【設計】Photo Media 前の再利用判定。
   *
   * 優先順位:
   * 1. completed は表示可能な既存 entry として返せるため、Photo Media と Cloud Task を両方 skip する。
   * 2. completed が無く Google import 由来(user_id=null)の未完了 media がある場合は、同じ ID を再処理対象にする。
   * 3. ユーザー投稿(user_id!=null)だけがある場合は、Google import の冪等性対象に巻き込まない。
   *
   * #829 【性能】dish_media は place/category join で大量取得せず、対象 dish_id 配下の代表 1 件だけを relation take で読む。
   * 将来 1 dish あたりの media が極端に増える場合は、schema への手書きコメントではなく migration で dish_media(dish_id, created_at) index を検討する。
   */
  async findReusableGoogleImportDishMediaByPlaceIdsAndCategory(
    placeIds: string[],
    categoryId: string,
  ): Promise<Map<string, ReusableGoogleImportDishMedia>> {
    if (placeIds.length === 0) return new Map();

    const dishes = await this.prisma.prisma.dishes.findMany({
      where: {
        category_id: categoryId,
        restaurants: {
          google_place_id: { in: placeIds },
        },
      },
      select: {
        id: true,
        restaurants: {
          select: { google_place_id: true },
        },
      },
    });
    if (dishes.length === 0) return new Map();

    const dishIds = dishes.map((dish) => dish.id);
    // #829 【性能】以降の media lookup は dish_id に閉じる。Text Search の place 数以上に探索範囲を広げない。
    const placeIdByDishId = new Map(
      dishes.map((dish) => [dish.id, dish.restaurants.google_place_id]),
    );

    // #829 【互換性】completed のみ、既存 assembler の URL でそのままフロントへ返せる。
    const dishesWithCompletedMedia = await this.prisma.prisma.dishes.findMany({
      where: { id: { in: dishIds } },
      select: {
        id: true,
        dish_media: {
          where: {
            // #829 【バグ】docstring どおり Google import 由来だけを再利用する。
            // ユーザー投稿を bulk-import の結果として返すと、投稿者以外の画面に
            // isMine/isSaved/isLiked が壊れた状態で出てしまう。
            user_id: null,
            media_processing_status: 'completed',
            thumbnail_processing_status: 'completed',
          },
          orderBy: { created_at: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    });

    const reusableMediaByPlaceId = new Map<
      string,
      ReusableGoogleImportDishMedia
    >();
    const dishIdsWithoutCompletedMedia: string[] = [];
    for (const dish of dishesWithCompletedMedia) {
      const placeId = placeIdByDishId.get(dish.id);
      const completedMedia = dish.dish_media[0];
      if (!placeId) continue;

      if (completedMedia) {
        reusableMediaByPlaceId.set(placeId, {
          dishMediaId: completedMedia.id,
          reuseKind: 'completed',
        });
      } else {
        dishIdsWithoutCompletedMedia.push(dish.id);
      }
    }

    if (dishIdsWithoutCompletedMedia.length === 0) {
      return reusableMediaByPlaceId;
    }

    // #829 【設計】未完了 media は Google import 由来だけ再利用する。ユーザー投稿は新規 Google import を妨げない。
    const dishesWithGoogleImportMedia =
      await this.prisma.prisma.dishes.findMany({
        where: { id: { in: dishIdsWithoutCompletedMedia } },
        select: {
          id: true,
          dish_media: {
            where: {
              user_id: null,
              // #829 【設計】failed も必ず lookup 対象に含める。
              //
              // failed を除外すると、その place は新規作成パスへ落ちて決定論 ID が
              // 新たに採番される。既存行は randomUUID 由来なので ID が一致せず、
              // skipDuplicates が効かないまま同じ Google レビューが二重登録される。
              // ID の再利用（重複防止）と Photo Media 課金の抑止は別の関心事であり、
              // ここで status を絞ると前者が壊れる。
              //
              // #1053 【解決済み】ここに「failed の place で Photo Media を毎回課金して
              // しまう件は別途対応する」と書いてあったが、**その対応は #1053 で入った**。
              // `dishes.service.ts` の `canSkipPhotoMedia` が、再利用する media_path の
              // 実体が GCS にあることを確かめたうえで Photo Media の呼び出しごと飛ばし、
              // handler へは photoUri 無しで enqueue して download も skip させる。
              //
              // したがって「resize に失敗して failed に張り付いた place を bulk-import
              // するたびに課金される」経路は塞がっている。写真バイナリ自体が無い
              // （media_path が無い / 実体が消えている）place で取り直すのは、
              // 課金の漏れではなく必要な取得である。
              //
              // 再利用が起きたことは ExistingGoogleImportDishMediaReused ログの
              // mediaProcessingStatus で数えられる。
              OR: [
                { media_processing_status: { not: 'completed' } },
                { thumbnail_processing_status: { not: 'completed' } },
              ],
            },
            orderBy: { created_at: 'asc' },
            take: 1,
            select: { id: true },
          },
        },
      });

    for (const dish of dishesWithGoogleImportMedia) {
      const placeId = placeIdByDishId.get(dish.id);
      const googleImportMedia = dish.dish_media[0];
      if (!placeId || !googleImportMedia) continue;

      reusableMediaByPlaceId.set(placeId, {
        dishMediaId: googleImportMedia.id,
        reuseKind: 'google-import-non-completed',
      });
    }

    return reusableMediaByPlaceId;
  }

  /**
   * #829 【バグ】handler は place/category では止めない。
   *
   * bulk-import が新しい dish_media.id を返したあとに、同じ place/category の未完了 row だけを理由に return すると、
   * レスポンス ID が永続化されない。Cloud Tasks retry の冪等性境界は payload の dish_media.id と completed 状態に限定する。
   */
  async isDishMediaCompleted(dishMediaId: string): Promise<boolean> {
    const dishMedia = await this.prisma.prisma.dish_media.findUnique({
      where: { id: dishMediaId },
      select: {
        media_processing_status: true,
        thumbnail_processing_status: true,
      },
    });

    return (
      dishMedia?.media_processing_status === 'completed' &&
      dishMedia.thumbnail_processing_status === 'completed'
    );
  }
}
