// api/src/v1/dish-media/dish-media.assembler.ts
//
// Assembler for composing dish media-related response models
//

import { Injectable } from '@nestjs/common';
import { StorageService } from '../../core/storage/storage.service';
import {
  buildResizedPath,
  buildTranscodedPath,
} from '../../core/storage/storage.utils';
import { DishMediaEntryEntity } from './dish-media.repository';
import { DishMediaEntry, MediaProcessingStatus } from '@shared/v1/res';
import { env } from '../../core/config/env';

import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { RestaurantsAssembler } from '../restaurants/restaurants.assembler';
import { CookieQueueService } from '../../core/cookie-queue/cookie-queue.service';
import { AppLoggerService } from 'src/core/logger/logger.service';

/**
 * #511 【設計】GCS パスから CDN URL を生成するユーティリティ関数
 */
function buildCdnUrlFromPath(gcsPath: string): string {
  return `https://${env.CDN_HOST}/${gcsPath}`;
}

@Injectable()
export class DishMediaAssembler {
  constructor(
    private readonly storage: StorageService,
    private readonly restaurantsAssembler: RestaurantsAssembler,
    private readonly cookieQueue: CookieQueueService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Repository から取得した `DishMediaEntryEntity[]` を
   * Controller 公開型の `DishMediaEntry[]` へ変換
   */
  toDishMediaEntry(dishMediaEntryEntities: DishMediaEntryEntity[]): {
    items: DishMediaEntry[];
  } {
    const items = dishMediaEntryEntities.map((src) => {
      const restaurant =
        this.restaurantsAssembler.enrichRestaurantsWithImageUrls(
          src.restaurant,
        );

      const dishBase = convertPrismaToSupabase_Dishes(src.dish);
      const dish = {
        ...dishBase,
        // Explicitly add only the required additional fields for DishMediaEntry.dish
        reviewCount: src.dish.reviewCount,
        averageRating: src.dish.averageRating,
      };

      const dishMediaBase = convertPrismaToSupabase_DishMedia(src.dish_media);
      const { mediaUrl } = this.getMediaUrl(src.dish_media);
      const thumbnailImageUrl = this.getThumbnailImageUrl(src.dish_media);
      const dish_media = {
        ...dishMediaBase,
        // Explicitly add only the required additional fields for DishMediaEntry.dish_media
        isMine: src.dish_media.isMine,
        isSaved: src.dish_media.isSaved,
        isLiked: src.dish_media.isLiked,
        likeCount: src.dish_media.likeCount,
        mediaUrl,
        thumbnailImageUrl,
      };

      const dish_reviews = src.dish_reviews.map((r) => {
        const reviewBase = convertPrismaToSupabase_DishReviews(r);
        return {
          ...reviewBase,
          // Explicitly add only the required additional fields for DishMediaEntry.dish_reviews
          username: r.username,
          isLiked: r.isLiked,
          likeCount: r.likeCount,
        };
      });

      return { restaurant, dish, dish_media, dish_reviews };
    });

    // #427 【設計】動画公開用プレフィックスの CDN Signed Cookie を生成してキューに登録
    const firstVideoUrl = items.find(
      (entry) =>
        entry.dish_media.media_type === 'video' &&
        entry.dish_media.mediaUrl !== null,
    )?.dish_media.mediaUrl;
    if (firstVideoUrl) {
      try {
        const url = new URL(firstVideoUrl);
        const segments = url.pathname.split('/').filter(Boolean);
        // #427 【設計】gs://bucket/${env}/transcoded-video/** を公開するための CDN URL プレフィックスを抽出
        const transcodedIndex = segments.indexOf('transcoded-video');
        if (transcodedIndex >= 0) {
          url.pathname =
            '/' + segments.slice(0, transcodedIndex + 1).join('/') + '/'; // /{env}/transcoded-video/
          const prefix = url.toString();
          const cookies = this.storage.generateCdnSignedCookies(prefix);
          cookies.forEach((cookie) => this.cookieQueue.enqueue(cookie));
        }
      } catch (err) {
        // Log error but don't fail the request - videos will be inaccessible but other data can still be returned
        this.logger.error('InvalidVideoUrlForCookie', 'toDishMediaEntry', {
          videoUrl: firstVideoUrl,
          error: err.message,
        });
      }
    }

    return { items };
  }

  /**
   * #511 【設計】dish_media エンティティから media_path の URL を生成
   *
   * 動画の場合:
   *   - media_processing_status が 'completed' の場合のみ CDN URL を返す
   *   - それ以外は null を返す（URLを返さない）
   *
   * 画像の場合:
   *   - media_processing_status が 'completed' の場合はリサイズ済みパスの Signed URL を返す
   *   - それ以外はオリジナルパスの Signed URL を返す
   */
  private getMediaUrl(dishMedia: DishMediaEntryEntity['dish_media']): {
    mediaUrl: string | null;
  } {
    const status =
      dishMedia.media_processing_status as MediaProcessingStatus | null;

    if (dishMedia.media_type === 'video') {
      // #511 【設計】動画: processing_status が 'completed' の場合のみ URL を返す
      if (status !== 'completed') {
        return { mediaUrl: null };
      }
      // 動画の場合の HLS マスター再生リスト CDN URL
      const cdnUrl = buildTranscodedPath(
        {
          table: 'dish_media',
          column: 'media_path',
          recordId: dishMedia.id,
          originalPath: dishMedia.media_path,
        },
        'cdn',
      );
      return { mediaUrl: cdnUrl };
    } else {
      // #511 【設計】画像: processing_status に応じてリサイズ済み or オリジナルを返す
      if (status === 'completed') {
        // 画像の場合のリサイズ CDN URL
        const cdnUrl = buildResizedPath(
          {
            table: 'dish_media',
            column: 'media_path',
            recordId: dishMedia.id,
            size: 1024,
            originalPath: dishMedia.media_path,
          },
          'cdn',
        );
        const mediaUrl = this.storage.generateCdnSignedURL(cdnUrl);
        return { mediaUrl };
      } else {
        // #511 【設計】未完了時はオリジナルパスの CDN Signed URL を返す
        const originalCdnUrl = buildCdnUrlFromPath(dishMedia.media_path);
        const mediaUrl = this.storage.generateCdnSignedURL(originalCdnUrl);
        return { mediaUrl };
      }
    }
  }

  /**
   * #511 【設計】dish_media エンティティからサムネイル画像の URL を生成
   *
   * thumbnail_processing_status が 'completed' の場合はリサイズ済みパスを返す
   * それ以外はオリジナルパスを返す
   */
  private getThumbnailImageUrl(
    dishMedia: DishMediaEntryEntity['dish_media'],
  ): string {
    const status =
      dishMedia.thumbnail_processing_status as MediaProcessingStatus | null;

    if (status === 'completed') {
      // リサイズ済みサムネイルパス
      const cdnUrl = buildResizedPath(
        {
          table: 'dish_media',
          column: 'thumbnail_path',
          recordId: dishMedia.id,
          size: 256,
          originalPath: dishMedia.thumbnail_path,
        },
        'cdn',
      );
      return this.storage.generateCdnSignedURL(cdnUrl);
    } else {
      // #511 【設計】未完了時はオリジナルパスの CDN Signed URL を返す
      const originalCdnUrl = buildCdnUrlFromPath(dishMedia.thumbnail_path);
      return this.storage.generateCdnSignedURL(originalCdnUrl);
    }
  }
}
