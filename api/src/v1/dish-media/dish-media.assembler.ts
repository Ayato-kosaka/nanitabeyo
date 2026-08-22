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
import {
  DishMediaEntry,
  DishMediaExternalEmbed,
  MediaProcessingStatus,
} from '@shared/v1/res';
import type { dish_media_external_embeddings as ExternalEmbedRow } from '../../../../shared/prisma/client';
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

/**
 * #1395 `dish_media` に増える列。
 *
 * マイグレーション（20260819T0100）適用後に `prisma db pull` で
 * `PrismaDishMedia` へ生えるが、それまでは型に存在しない。
 * 生成物の再生成タイミングに実装を縛られないよう、**optional** の構造型として重ねる。
 * 再生成後もそのまま代入互換なので、この宣言は消さなくてよい。
 */
type DishMediaRenderColumns = {
  /** 'stored' | 'external_embed' */
  render_type?: string | null;
};

/**
 * サムネイル URL の組み立てに必要な最小限の列。
 *
 * #1395 サムネイルは全 provider について取り込み時に自ストレージへ保存する
 * （統一キャッシュ方式）ので、`render_type` によらず必要な列はこの 3 つだけである。
 */
export type ThumbnailUrlSource = {
  id: string;
  thumbnail_path: string;
  thumbnail_processing_status: string;
};

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
        // #1399 render_type='external_embed' の行だけが持つ。**html は返さない**
        // （#1375 設計の正本 §2 / #1273 §14。埋め込みは canonicalUrl から都度描く）
        externalEmbed: this.toExternalEmbed(src.dish_media.externalEmbed),
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
   *
   * #1395 render_type が 'external_embed' のときは自ストレージに実体が無いので
   * 署名 URL を作らず null を返す。`mediaUrl` は既に nullable なのでレスポンス型は壊れない。
   */
  private getMediaUrl(
    dishMedia: DishMediaEntryEntity['dish_media'] & DishMediaRenderColumns,
  ): {
    mediaUrl: string | null;
  } {
    // #1395 external_embed は自ストレージに実体が無いので署名 URL を作らない。
    // 表示は provider 別コンポーネントが canonical_url から行う（#1273 §14）
    if (dishMedia.render_type === 'external_embed') {
      return { mediaUrl: null };
    }
    // #1395 media_path は nullable 化される（render_type='stored' のときだけ CHECK で必須）。
    // 万一 stored なのに欠けていたら URL を作らない
    if (!dishMedia.media_path) {
      return { mediaUrl: null };
    }

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
   * #1399 `dish_media_external_embeddings` の行を API の形へ写す。
   *
   * ⚠️ `thumbnailUrl` は **provider 側の URL** であって自ストレージの署名 URL ではない。
   * 権利上サムネイルを複製できない provider があるため、参照として持っている
   * （migration 20260822T0000 のヘッダに理由がある）。したがってここで署名は付けない。
   */
  private toExternalEmbed(
    row: ExternalEmbedRow | null | undefined,
  ): DishMediaExternalEmbed | null {
    if (!row) return null;
    return {
      provider: row.provider as DishMediaExternalEmbed['provider'],
      externalContentId: row.external_content_id,
      canonicalUrl: row.canonical_url,
      embedStatus: row.embed_status as DishMediaExternalEmbed['embedStatus'],
      lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
      thumbnailUrl: row.thumbnail_url ?? null,
      publishedAt: row.published_at?.toISOString() ?? null,
    };
  }

  /**
   * #511 【設計】dish_media エンティティからサムネイル画像の URL を生成
   *
   * thumbnail_processing_status が 'completed' の場合はリサイズ済みパスを返す
   * それ以外はオリジナルパスを返す
   *
   * #1395 Map ピンのように `DishMediaEntry` を丸ごと組み立てない経路からも
   * 同じ規則を使えるよう public にしてある（サムネイル URL の組み立てを 2 箇所に持たない）。
   * ロジック自体は無改修である（サムネイルは全 provider が自ストレージ持ちのため）。
   */
  public getThumbnailImageUrl(dishMedia: ThumbnailUrlSource): string {
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
