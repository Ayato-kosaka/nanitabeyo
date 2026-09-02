// api/src/internal/dishes/create-dish-media-entry.service.ts
//
// ❶ Cloud Tasks から呼び出される非同期処理の実装
// ❂ 責務: 写真ダウンロード + DB登録（分割されたロジック）
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { CreateDishMediaEntryJobPayload } from './create-dish-media-entry.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../core/storage/storage.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishesRepository } from '../../v1/dishes/dishes.repository';
import {
  convertSupabaseToPrisma_Restaurants,
  PrismaRestaurants,
} from '../../../../shared/converters/convert_restaurants';
import { convertSupabaseToPrisma_Dishes } from '../../../../shared/converters/convert_dishes';
import {
  convertSupabaseToPrisma_DishMedia,
  PrismaDishMedia,
} from '../../../../shared/converters/convert_dish_media';
import { convertSupabaseToPrisma_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { CloudTasksService } from 'src/core/cloud-tasks/cloud-tasks.service';

@Injectable()
export class CreateDishMediaEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
    private readonly dishesRepository: DishesRepository,
    private readonly cloudTasksService: CloudTasksService,
  ) {}

  /**
   * 非同期ジョブの処理メイン関数
   */
  async processAsyncJob(
    payload: CreateDishMediaEntryJobPayload,
  ): Promise<void> {
    this.logger.debug('ProcessAsyncJob Started', 'processAsyncJob', {
      jobId: payload.jobId,
      photoUriCount: payload.photoUri.length,
    });

    // #829 【バグ】place/category で止めると、bulk-import が返した別 ID の row が作られず orphan response になる。
    // #829 【設計】handler retry は同じ payload ID が completed 済みのときだけ処理済みとみなす。
    const isAlreadyProcessed = await this.checkIdempotency(payload);
    if (isAlreadyProcessed) {
      this.logger.log('JobAlreadyProcessed', 'processAsyncJob', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
      });
      return;
    }

    try {
      // 写真のダウンロードと保存を並列処理
      await this.downloadAndStorePhotos(payload);

      // 4テーブルのUPSERT処理
      const { restaurant, dishMedia } =
        await this.upsertDatabaseEntries(payload);

      // 画像リサイズの非同期ジョブをキューに投入
      await this.enqueueResizeImageJob(dishMedia, restaurant);

      // 冪等性キーを記録（処理完了マーク）
      await this.markJobCompleted(payload.idempotencyKey);

      this.logger.log('ProcessAsyncJob Completed', 'processAsyncJob', {
        jobId: payload.jobId,
        idempotencyKey: payload.idempotencyKey,
      });
    } catch (error) {
      this.logger.error('ProcessAsyncJob Error', 'processAsyncJob', {
        jobId: payload.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * 写真のダウンロードと保存を並列処理
   */
  private async downloadAndStorePhotos(
    payload: CreateDishMediaEntryJobPayload,
  ): Promise<void> {
    // #1395 media_path は external_embed（SNS の公式埋め込み）のために nullable 化された。
    // ただし **この経路が作るのは常に render_type='stored'**（自ストレージへ写真を保存する行）
    // であり、media_path は呼び出し側で必ず組み立てられている。
    // null で来るのは payload の組み立てが壊れているときだけなので、ここで 1 度だけ絞って落とす。
    // 各利用箇所へ `!` を撒くと、本当に null が来たとき «GCS の空パスへ書きに行く» という
    // 分かりにくい壊れ方をする。
    const mediaPath = payload.dish_media.media_path;
    if (mediaPath === null) {
      throw new Error(
        `media_path is required for stored dish_media (jobId=${payload.jobId})`,
      );
    }

    // #514 【設計】原本の有無を先に見る。photoUri の有無では分岐しない。
    //
    // 保存に成功した後、DB transaction や resize enqueue で落ちると、Cloud Tasks は
    // 同じ payload で再試行する。そのとき Google の photoUri は既に期限切れや 429 に
    // なっていることがあり、fetch から始めると「GCS には有効な原本があるのに
    // ダウンロードだけが永久に失敗する」状態になる（リトライ上限まで消費して
    // processing の行が残る）。原本があるなら download は要らない。
    //
    // #1053 【課金】bulk-import が「GCS に実体あり」と判定した再利用パスでは photoUri が空。
    // その場合も同じ判定に乗る。実体があるのに Photo Media を取り直して課金しない。
    //
    // `uploadFileAtPath` は `overwriteIfExists: false` なので、実体がある状態で
    // download しても保存は no-op になる。先に確認しても結果は変わらない。
    const originalExists = await this.storage.fileExists(mediaPath);
    if (originalExists) {
      this.logger.debug('PhotoDownloadSkipped', 'downloadAndStorePhotos', {
        jobId: payload.jobId,
        mediaPath,
        hasPhotoUri: payload.photoUri.length > 0,
      });
      return;
    }

    // 原本が無く、取りに行く先も無い。DB 登録と resize enqueue へ進めてはいけない。
    if (payload.photoUri.length === 0) {
      throw new Error(`Stored photo is missing: ${mediaPath}`);
    }

    const downloadPromises = payload.photoUri.map(async (photoUri, index) => {
      try {
        // 写真データを取得
        const response = await fetch(photoUri);
        if (!response.ok) {
          throw new Error(`Failed to download photo: ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // ストレージに保存（事前に生成されたmedia_pathを使用）
        const uploadResult = await this.storage.uploadFileAtPath({
          buffer,
          mimeType: 'image/jpeg', // Assuming JPEG, adjust if necessary
          fullPath: mediaPath,
          overwriteIfExists: false, // 冪等性のため既存ファイルは上書きしない
        });

        this.logger.debug('PhotoDownloaded', 'downloadAndStorePhotos', {
          originalUri: photoUri,
          uploadedPath: uploadResult.signedUrl,
          mediaPath: payload.dish_media.media_path,
        });

        return uploadResult.signedUrl;
      } catch (error) {
        this.logger.error('PhotoDownloadError', 'downloadAndStorePhotos', {
          photoUri,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Cloud Tasks に失敗を返し、429 や一時的な GCS 障害を再試行させる。
        // 原本が無いまま DB 登録と resize enqueue を続けてはいけない。
        throw error;
      }
    });

    await Promise.all(downloadPromises);
  }

  /**
   * 画像リサイズの非同期ジョブをキューに投入
   */
  private async enqueueResizeImageJob(
    dishMedia: PrismaDishMedia,
    restaurants: PrismaRestaurants,
  ) {
    // #1053 【設計】分岐判定は media/thumbnail の AND なので、
    // 「media=completed / thumbnail=processing」は未完了に倒れて handler が再実行される。
    // そのとき completed 側まで再 enqueue すると、resize-image 側が fileExists で
    // 早期 return するため画像処理自体は走らないものの、Cloud Tasks の実行回数と
    // Cloud Run のリクエスト数だけが二重に増える。completed の列は skip する。
    // #1395 media_path が null なのは render_type='external_embed' の行だけで、
    // あれは自ストレージに実体を持たないためリサイズの対象にならない。
    // ここへ来る時点で 'stored' のはずだが、型の上では null を取りうるので明示的に skip する。
    const skipMedia =
      dishMedia.media_processing_status === 'completed' ||
      dishMedia.media_path === null;
    const skipThumbnail = dishMedia.thumbnail_processing_status === 'completed';

    if (skipMedia || skipThumbnail) {
      this.logger.debug('ResizeEnqueueSkipped', 'enqueueResizeImageJob', {
        dishMediaId: dishMedia.id,
        skipMedia,
        skipThumbnail,
      });
    }

    return Promise.all([
      // メイン画像リサイズジョブ
      !skipMedia &&
        this.cloudTasksService
          .enqueueResizeImage({
            table: 'dish_media',
            column: 'media_path',
            recordId: dishMedia.id,
            size: 1024,
            aspectRatio: 9 / 16,
            originalPath: dishMedia.media_path ?? '',
          })
          .catch((error) => {
            this.logger.error(
              'EnqueueResizeImageError',
              'createDishMediaEntry',
              {
                dishMediaId: dishMedia.id,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            );
            throw error;
          }),
      // サムネイル画像リサイズジョブ
      !skipThumbnail &&
        this.cloudTasksService
          .enqueueResizeImage({
            table: 'dish_media',
            column: 'thumbnail_path',
            recordId: dishMedia.id,
            size: 256,
            aspectRatio: 9 / 16,
            originalPath: dishMedia.thumbnail_path,
          })
          .catch((error) => {
            this.logger.error(
              'EnqueueResizeThumbnailError',
              'createDishMediaEntry',
              {
                dishMediaId: dishMedia.id,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            );
            throw error;
          }),
      restaurants.image_path &&
        this.cloudTasksService
          .enqueueResizeImage({
            table: 'restaurants',
            column: 'image_path',
            recordId: restaurants.id,
            size: 256,
            aspectRatio: 9 / 16,
            originalPath: restaurants.image_path,
          })
          .catch((error) => {
            this.logger.error(
              'EnqueueResizeRestaurantImageError',
              'createDishMediaEntry',
              {
                restaurantId: restaurants.id,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            );
            throw error;
          }),
      restaurants.image_path &&
        this.cloudTasksService
          .enqueueResizeImage({
            table: 'restaurants',
            column: 'image_path',
            recordId: restaurants.id,
            size: 64,
            aspectRatio: 9 / 16,
            originalPath: restaurants.image_path,
          })
          .catch((error) => {
            this.logger.error(
              'EnqueueResizeRestaurantImageError',
              'createDishMediaEntry',
              {
                restaurantId: restaurants.id,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            );
            throw error;
          }),
    ]);
  }

  /**
   * #514 既存 restaurant の `image_path` を新しい原本へ貼り替えてよいかを判定する。
   *
   * 貼り替えるのは「今の path が壊れている」ときだけにする。無条件に上書きすると、
   * 同じ place へ別カテゴリを import するたびに店舗画像が入れ替わり、その都度
   * resize 完了までの間だけ CDN が 404 を返す（bug を直すついでに UI を揺らす）。
   *
   * 貼り替え先として許すのは `dish_media.media_path` と一致する path だけ。
   * `downloadAndStorePhotos` が GCS 上の存在を確認したのはこの path であり、
   * 未確認の path を書き込むと #514 と同じ「原本の無い path」を作ってしまう。
   */
  private async shouldAdoptNewRestaurantImagePath(
    payload: CreateDishMediaEntryJobPayload,
  ): Promise<boolean> {
    const nextPath = payload.restaurants.image_path;
    if (!nextPath) return false;

    if (nextPath !== payload.dish_media.media_path) {
      this.logger.warn(
        'RestaurantImagePathNotVerified',
        'shouldAdoptNewRestaurantImagePath',
        {
          jobId: payload.jobId,
          imagePath: nextPath,
          mediaPath: payload.dish_media.media_path,
        },
      );
      return false;
    }

    const existing =
      await this.dishesRepository.findRestaurantImagePathByGooglePlaceId(
        payload.restaurants.google_place_id,
      );
    // 行がまだ無いなら upsert の create 側で新しい path が入る。
    if (!existing) return false;
    if (!existing.image_path) return true;
    if (existing.image_path === nextPath) return false;

    const currentExists = await this.storage.fileExists(existing.image_path);
    if (currentExists) return false;

    this.logger.log(
      'RestaurantImagePathRepaired',
      'shouldAdoptNewRestaurantImagePath',
      {
        jobId: payload.jobId,
        googlePlaceId: payload.restaurants.google_place_id,
        staleImagePath: existing.image_path,
        nextImagePath: nextPath,
      },
    );
    return true;
  }

  /**
   * 4テーブルのUPSERT処理（dishesRepository を使用）
   */
  private async upsertDatabaseEntries(payload: CreateDishMediaEntryJobPayload) {
    const updateImagePath =
      await this.shouldAdoptNewRestaurantImagePath(payload);

    return await this.prisma.withTransaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. レストラン登録
        const restaurant = await this.dishesRepository.createOrGetRestaurant(
          tx,
          {
            ...convertSupabaseToPrisma_Restaurants(payload.restaurants),
            address_components: payload.restaurants
              .address_components as Prisma.InputJsonValue,
            plus_code: payload.restaurants.plus_code as Prisma.InputJsonValue,
          },
          payload.restaurants.google_place_id,
          { updateImagePath },
        );

        // 2. 料理登録
        const dish = await this.dishesRepository.createOrGetDishForCategory(
          tx,
          {
            ...convertSupabaseToPrisma_Dishes(payload.dishes),
            restaurant_id: restaurant.id,
          },
        );

        // 3. 料理メディア登録
        const dishMedia = await this.dishesRepository.createDishMedia(
          tx,
          convertSupabaseToPrisma_DishMedia({
            ...payload.dish_media,
            dish_id: dish.id,
          }),
        );

        // 4. 料理レビュー登録
        const dishReciews = await this.dishesRepository.createDishReviews(
          tx,
          payload.dish_reviews.map((review) => ({
            ...convertSupabaseToPrisma_DishReviews(review),
            dish_id: dish.id,
          })),
        );

        return { restaurant, dish, dishMedia, dishReciews };
      },
    );
  }

  /**
   * #829 【設計】Cloud Tasks retry の冪等性境界。
   *
   * processing の同一 ID は、DB insert 後に画像保存や resize enqueue で落ちた可能性があるため再実行する。
   * completed の同一 ID だけを return 対象にして、未完了 row の復旧余地を残す。
   */
  private async checkIdempotency(
    payload: CreateDishMediaEntryJobPayload,
  ): Promise<boolean> {
    return this.dishesRepository.isDishMediaCompleted(payload.dish_media.id);
  }

  /**
   * ジョブ完了マーク
   */
  private async markJobCompleted(idempotencyKey: string): Promise<void> {
    // TODO: Redis や専用テーブルに完了マークを記録
    this.logger.debug('JobMarkCompleted', 'markJobCompleted', {
      idempotencyKey,
    });
  }
}
