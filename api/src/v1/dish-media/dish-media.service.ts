import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { env, logBackendEvent } from '../../lib';
import { GooglePlacesService } from './google-places.service';
import {
  DishMediaItem,
  ListDishMediaResponse,
  Review,
} from './interfaces/dish-media.types';
import { ListDishMediaQuery } from './dto/list-dish-media.dto';

/**
 * 🍽️ DishMedia を生成するサービス
 * - Google Places API を利用して料理写真と口コミを取得する
 */
@Injectable()
export class DishMediaService {
  constructor(private readonly gp: GooglePlacesService) {}

  /**
   * listDishMedia API のメイン処理
   */
  async listDishMedia(params: ListDishMediaQuery): Promise<ListDishMediaResponse> {
    const requestId = nanoid(12);
    void logBackendEvent({
      event_name: 'listDishMediaCalled',
      error_level: 'INFO',
      function_name: 'DishMediaService.listDishMedia',
      user_id: 'anonymous',
      payload: params,
      request_id: requestId,
    });

    const { lat, lng, radius, limit, lang, category, pageToken } = params;

    // 🌐 まずは周辺店舗を検索
    const searchJson = await this.gp.nearbySearch({
      lat,
      lng,
      radius,
      lang,
      keyword: category,
      pageToken,
    });

    const items: DishMediaItem[] = [];
    for (const searchResult of searchJson.results.slice(0, limit)) {
      // 各店舗の詳細情報を取得
      const detailsJson = await this.gp.placeDetails(
        searchResult.place_id,
        lang,
      );
      const details = detailsJson.result;

      const reviews: Review[] = (details.reviews ?? [])
        .filter((r: any) => r.rating >= 4 && r.text)
        .slice(0, 3)
        .map((r: any) => ({
          author: r.author_name,
          rating: r.rating,
          text: r.text,
          translated: Boolean(r.translated),
        }));

      const photoRef = details.photos?.[0]?.photo_reference;
      const photoUrl = photoRef
        ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${photoRef}&key=${env.API_GOOGLE_PLACE_API_KEY}`
        : '';

      const dishName =
        reviews[0]?.text.split(/[。.!?]/)[0].slice(0, 20) ?? details.name;

      items.push({
        dishId: `dm_${details.place_id}_${nanoid(6)}`,
        dishName,
        category: category ?? '',
        photoUrl,
        rating: details.rating ?? 0,
        reviewCount: details.user_ratings_total ?? 0,
        distanceMeters: searchResult.distance_meters ?? 0,
        place: {
          placeId: details.place_id,
          name: details.name,
          vicinity: details.vicinity,
          location: details.geometry.location,
          googleMapUrl: details.url,
        },
        reviews,
      });
    }

    return {
      items,
      nextPageToken: searchJson.next_page_token,
    };
  }
}
