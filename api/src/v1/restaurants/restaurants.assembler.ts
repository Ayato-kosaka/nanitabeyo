// RestaurantsAssembler: レストランプロフィールに署名付きURLやCDN URL群を付与する
// api/src/v1/restaurants/restaurants.assembler.ts
//

import { Injectable } from '@nestjs/common';
import { RestaurantsEntity } from '@shared/v1/res';
import { StorageService } from '../../core/storage/storage.service';
import {
  buildDishMediaThumbnailUrl,
  type ThumbnailUrlSource,
} from '../dish-media/dish-media-thumbnail';
import { buildResizedPath } from '../../core/storage/storage.utils';
import {
  convertPrismaToSupabase_Restaurants,
  PrismaRestaurants,
  SupabaseRestaurants,
} from '../../../../shared/converters/convert_restaurants';

@Injectable()
export class RestaurantsAssembler {
  constructor(private readonly storage: StorageService) {}

  /**
   * レストランプロフィールに署名付き CDN URL群を付与する
   *
   * #1780 【設計】**`image_path` を持たない店は、dish_media のサムネイルを顔にする。**
   *
   * #1793 で Google の写真を自社 Storage へ複製するのをやめたので、これ以降に作られる店の
   * `image_path` は必ず null になる。ここで代替を当てないと、**新しい店が全部«画像なし»**に
   * なり、店詳細・店名検索・保存済み店・地図ピンが空の枠を描く。
   * オーナー確定仕様（#1780 の 2026-09-02 判断ログ）の実装がこれである。
   *
   * `fallbackThumbnail` は呼び出し側が **まとめて 1 クエリで**引いて渡す
   * （`DishMediaRepository.findFallbackThumbnailsByRestaurantIds`）。ここで引くと
   * 一覧が店の数だけクエリを撃つ（N+1）。渡されなければ従来どおり `image_path` だけを見る。
   *
   * ⚠️ **`sm` にも 256px を入れている。** dish_media のサムネイルは 256 しか焼いていない
   *    （`dish-media.service.ts` が enqueue するのは 256 の 1 本だけ）ので、64 を組み立てても
   *    その実体は存在せず 404 になる。`imageUrls.sm` の «64x64» は
   *    `restaurants.image_path` 由来のときだけ成り立つ。表示側は 40〜64px の枠に
   *    はめているだけなので、大きい絵が来ても見た目は変わらない。
   */
  enrichRestaurantsWithImageUrls(
    restaurants: PrismaRestaurants,
    fallbackThumbnail?: ThumbnailUrlSource | null,
  ): RestaurantsEntity {
    const supabaseRestaurants: SupabaseRestaurants =
      convertPrismaToSupabase_Restaurants(restaurants);

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
    } else if (fallbackThumbnail) {
      /*
      組み立ての規則は `dish-media-thumbnail.ts` が正本。**ここへ写さないこと** —
      `thumbnail_processing_status` によって参照先が変わるので、写せば
      «片方だけ直った» が起きる。
      */
      const url = buildDishMediaThumbnailUrl(this.storage, fallbackThumbnail);
      if (url) imageUrls = { sm: url, md: url };
    }

    return { ...supabaseRestaurants, imageUrls };
  }
}
