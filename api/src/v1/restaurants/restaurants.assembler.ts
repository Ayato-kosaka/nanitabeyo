// RestaurantsAssembler: レストランプロフィールに署名付きURLやCDN URL群を付与する
// api/src/v1/restaurants/restaurants.assembler.ts
//

import { Injectable } from '@nestjs/common';
import { RestaurantsEntity } from '@shared/v1/res';
import { StorageService } from '../../core/storage/storage.service';
import { buildResizedPath } from '../../core/storage/storage.utils';
import {
  convertPrismaToSupabase_Restaurants,
  PrismaRestaurants,
  SupabaseRestaurants,
} from '../../../../shared/converters/convert_restaurants';

@Injectable()
export class RestaurantsAssembler {
  constructor(private readonly storage: StorageService) { }

  /**
   * レストランプロフィールに署名付き CDN URL群を付与する
   */
  enrichRestaurantsWithImageUrls(
    restaurants: PrismaRestaurants,
  ): RestaurantsEntity {
    const supabaseRestaurants: SupabaseRestaurants = convertPrismaToSupabase_Restaurants(restaurants);

    // レストランの写真がある場合のみ、
    // 派生サイズ の署名付き CDN URL群 を生成して付与する
    let imageUrls: { sm: string; md: string } | undefined;
    if (restaurants.image_path) {
      // 画像の派生サイズ CDN URL 群
      imageUrls = {
        sm: this.storage.generateCdnSignedURL(
          buildResizedPath(
            {
              table: 'restaurants',
              column: 'image_path',
              recordId: restaurants.id,
              size: 64,
              originalPath: restaurants.image_path,
            },
            'cdn',
          ),
        ),
        md: this.storage.generateCdnSignedURL(
          buildResizedPath(
            {
              table: 'restaurants',
              column: 'image_path',
              recordId: restaurants.id,
              size: 256,
              originalPath: restaurants.image_path,
            },
            'cdn',
          ),
        ),
      };
    }

    return { ...supabaseRestaurants, imageUrls };
  }
}
