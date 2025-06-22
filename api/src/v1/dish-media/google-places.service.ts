import { Injectable } from '@nestjs/common';
import { PlacesClient } from '@googlemaps/places';
import { env } from '../../lib';

/**
 * 🌐 Google Places API を扱うサービス
 * - `@googlemaps/places` ライブラリを利用してAPI呼び出しを行う
 */
@Injectable()
export class GooglePlacesService {
  private client = new PlacesClient({ apiKey: env.API_GOOGLE_PLACE_API_KEY });

  /** 周辺検索API */
  async nearbySearch(params: {
    lat: number;
    lng: number;
    radius: number;
    lang: string;
    limit: number;
    /** CSV 形式のカテゴリ(例: "ramen,sushi") */
    categories?: string;
    pageToken?: string;
  }): Promise<any> {
    const { lat, lng, radius, lang, limit, categories, pageToken } = params;
    return this.client.searchNearby({
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
      includedTypes: ['restaurant', ...(categories ? categories.split(',') : [])],
    } as any);
      languageCode: lang,
      keyword,
      includedTypes: ['restaurant'],
      maxResultCount: Math.min(limit, 20),
      pageToken,
    });
  }

  /** 店舗詳細API */
  async placeDetails(placeId: string, lang: string): Promise<any> {
    return this.client.getPlace({
      name: `places/${placeId}`,
      languageCode: lang,
    });
  }
}

