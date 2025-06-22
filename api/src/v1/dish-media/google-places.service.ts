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
    keyword?: string;
    pageToken?: string;
  }): Promise<any> {
    const { lat, lng, radius, lang, keyword, pageToken } = params;
    return this.client.searchNearby({
      location: { latitude: lat, longitude: lng },
      radius,
      languageCode: lang,
      keyword,
      pageToken,
      type: 'RESTAURANT',
    });
  }

  /** 店舗詳細API */
  async placeDetails(placeId: string, lang: string): Promise<any> {
    return this.client.getPlace({
      name: `places/${placeId}`,
      languageCode: lang,
      fields: [
        'id',
        'displayName',
        'shortFormattedAddress',
        'location',
        'googleMapsUri',
        'rating',
        'userRatingCount',
        'photos',
        'reviews',
      ],
    });
  }
}

