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
import { DishMediaEntry } from '@shared/v1/res';

import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { mapWithConcurrency } from 'src/core/utils/backend-utils';
import { env } from 'src/core/config/env';
import { RestaurantsAssembler } from '../restaurants/restaurants.assembler';
import { CookieQueueService } from '../../core/cookie-queue/cookie-queue.service';

@Injectable()
export class DishMediaAssembler {
  constructor(
    private readonly storage: StorageService,
    private readonly restaurantsAssembler: RestaurantsAssembler,
    private readonly cookieQueue: CookieQueueService,
  ) {}

  /**
   * Repository から取得した `DishMediaEntryEntity[]` を
   * Controller 公開型の `DishMediaEntry[]` へ変換
   */
  toDishMediaEntry(dishMediaEntryEntities: DishMediaEntryEntity[]): {
    items: DishMediaEntry[];
  } {
    const videoCdnUrlPrefixes: string[] = [];

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
      const { mediaUrl, cdnUrlPrefix } = this.getMediaUrl(src.dish_media);
      if (cdnUrlPrefix) {
        videoCdnUrlPrefixes.push(cdnUrlPrefix);
      }
      const thumbnailImageUrl = this.getThumbnailImageUrl(src.dish_media);
      const dish_media = {
        ...dishMediaBase,
        // Explicitly add only the required additional fields for DishMediaEntry.dish_media
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

    // #427 【設計】動画用の CDN Signed Cookie を生成してキューに登録（重複排除）
    const uniquePrefixes = Array.from(new Set(videoCdnUrlPrefixes));
    uniquePrefixes.forEach((prefix) => {
      const cookies = this.storage.generateCdnSignedCookies(prefix);
      cookies.forEach((cookie) => this.cookieQueue.enqueue(cookie));
    });

    return { items };
  }

  /**
   * dish_media エンティティから media_path の CDN URL を生成して付与
   *
   * 動画の場合:
   *   - プレーンな CDN URL を返す（署名なし）
   *   - 認可は Signed Cookie で行うため、CDN URL プレフィックスも返す
   *
   * 画像の場合:
   *   - 従来通り Signed URL を返す（単一ファイルアクセスのため Cookie 不要）
   */
  private getMediaUrl(dishMedia: DishMediaEntryEntity['dish_media']): {
    mediaUrl: string;
    cdnUrlPrefix?: string;
  } {
    const cdnUrl =
      dishMedia.media_type === 'video'
        ? // 動画の場合の HLS マスター再生リスト CDN URL
          buildTranscodedPath(
            {
              table: 'dish_media',
              column: 'media_path',
              recordId: dishMedia.id,
              originalPath: dishMedia.media_path,
            },
            'cdn',
          )
        : // 画像の場合のリサイズ CDN URL
          buildResizedPath(
            {
              table: 'dish_media',
              column: 'media_path',
              recordId: dishMedia.id,
              size: 1024,
              originalPath: dishMedia.media_path,
            },
            'cdn',
          );

    if (dishMedia.media_type === 'video') {
      // 動画: プレーンな CDN URL を返し、Cookie 設定用のプレフィックスも返す
      return {
        mediaUrl: cdnUrl,
        cdnUrlPrefix: cdnUrl,
      };
    } else {
      // 画像: 従来通り Signed URL を返す
      const mediaUrl = this.storage.generateCdnSignedURL(cdnUrl);
      return { mediaUrl };
    }
  }

  private getThumbnailImageUrl(
    dishMedia: DishMediaEntryEntity['dish_media'],
  ): string {
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

    // 派生サイズの署名付き CDN URL を生成
    const thumbnailImageUrl = this.storage.generateCdnSignedURL(cdnUrl);

    return thumbnailImageUrl;
  }
}
