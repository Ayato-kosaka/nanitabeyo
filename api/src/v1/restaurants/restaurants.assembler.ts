// RestaurantsAssembler: レストランプロフィールに署名付きURLやCDN URL群を付与する
// api/src/v1/restaurants/restaurants.assembler.ts
//

import { Injectable } from '@nestjs/common';
import { RestaurantsEntity } from '@shared/v1/res';
import { StorageService } from '../../core/storage/storage.service';
import { buildResizedPath } from '../../core/storage/storage.utils';
import { convertPrismaToSupabase_Restaurants, PrismaRestaurants, SupabaseRestaurants } from '../../../../shared/converters/convert_restaurants';

@Injectable()
export class RestaurantsAssembler {
  constructor(private readonly storage: StorageService) { }

  /**
   * レストランプロフィールに署名付きURLやCDN URL群を付与する
   */
  async enrichRestaurantsWithImageUrls(
    restaurants: PrismaRestaurants,
  ): Promise<RestaurantsEntity> {
    const supabaseRestaurants: SupabaseRestaurants = convertPrismaToSupabase_Restaurants(restaurants);

    // レストランの写真がある場合のみ、
    // 署名付きURL, 派生サイズ の CDN URL, URL群 を生成して付与する
    let imageSignedUrl: string | undefined;
    let imageUrls: { sm: string; md: string } | undefined;
    if (restaurants.image_path) {
      // 画像の署名付きURL（原本）
      imageSignedUrl = await this.storage.generateSignedUrl(restaurants.image_path);

      // 画像の派生サイズ CDN URL 群
      imageUrls = {
        sm: buildResizedPath(
          {
            table: 'restaurants',
            column: 'image_path',
            recordId: restaurants.id,
            size: 64,
            originalPath: restaurants.image_path,
          },
          'cdn',
        ),
        md: buildResizedPath(
          {
            table: 'restaurants',
            column: 'image_path',
            recordId: restaurants.id,
            size: 256,
            originalPath: restaurants.image_path,
          },
          'cdn',
        ),
      };

      this.storage.generateCdnSignedCookies(
        imageUrls.sm.split('/').slice(0, -1).join('/'),
      );
    }

    return { ...supabaseRestaurants, imageSignedUrl, imageUrls };
  }
}
