// api/src/v1/dish-media/dish-media.assembler.ts
//
// Assembler for composing dish media-related response models
//

import { Injectable } from '@nestjs/common';
import { StorageService } from '../../core/storage/storage.service';
import { buildResizedPath } from '../../core/storage/storage.utils';
import { DishMediaEntryEntity } from './dish-media.repository';
import { DishMediaEntry } from '@shared/v1/res';

import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { mapWithConcurrency } from 'src/core/utils/backend-utils';
import { env } from 'src/core/config/env';
import { RestaurantsAssembler } from '../restaurants/restaurants.assembler';

@Injectable()
export class DishMediaAssembler {
  constructor(
    private readonly storage: StorageService,
    private readonly restaurantsAssembler: RestaurantsAssembler,
  ) { }

  /**
   * Repository から取得した `DishMediaEntryEntity[]` を
   * Controller 公開型の `DishMediaEntry[]` へ変換
   */
  async toDishMediaEntry(
    dishMediaEntryEntities: DishMediaEntryEntity[],
  ): Promise<{ items: DishMediaEntry[]; cdnCookies: string[] }> {
    const cdnCookies: string[] = [];
    const items = await mapWithConcurrency(
      dishMediaEntryEntities,
      async (src) => {
        const restaurant = await this.restaurantsAssembler.enrichRestaurantsWithImageUrls(src.restaurant);

        const dishBase = convertPrismaToSupabase_Dishes(src.dish);
        const dish = {
          ...dishBase,
          // Explicitly add only the required additional fields for DishMediaEntry.dish
          reviewCount: src.dish.reviewCount,
          averageRating: src.dish.averageRating,
        };

        const dishMediaBase = convertPrismaToSupabase_DishMedia(src.dish_media);
        const mediaUrl = this.getMediaUrl(src.dish_media, cdnCookies)
        const thumbnailImageUrl = this.getThumbnailImageUrl(src.dish_media, cdnCookies)
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
      },
      12, // concurrency
    ).then((list) => list.filter((v): v is NonNullable<typeof v> => !!v));
    return { items, cdnCookies };
  }

  /**
   * dish_media エンティティから media_path の署名付き URL, CDN URL 群 を生成して付与
   */
  private getMediaUrl(
    dishMedia: DishMediaEntryEntity['dish_media'],
    cdnCookies: string[],
  ): string {
    const cdnUrl =
      dishMedia.media_type === 'video'
        ? // 動画の場合の HLS マスター再生リスト CDN URL
        `https://${env.CDN_HOST}/${env.API_NODE_ENV}/transcoded/dish_media/media_path/${dishMedia.id}/master.m3u8`
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

    // 派生サイズの署名付き CDN URL を生成
    const mediaUrl = this.storage.generateCdnSignedURL(cdnUrl, { urlPrefix: dishMedia.media_type === 'video' });

    return mediaUrl;
  }

  private getThumbnailImageUrl(
    dishMedia: DishMediaEntryEntity['dish_media'],
    cdnCookies: string[],
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
