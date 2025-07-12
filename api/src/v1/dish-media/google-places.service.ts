import { Injectable } from '@nestjs/common';
import { PlacesClient } from '@googlemaps/places';
import { env } from '../../lib';

// 周辺検索で欲しい項目
const NEARBY_MASK =
  'places.id,places.displayName,places.location,places.photos';

// 店舗詳細で欲しい項目
const DETAILS_MASK =
  'id,displayName,shortFormattedAddress,location,rating,' +
  'userRatingCount,googleMapsUri,photos,reviews';

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
  }) {
    const { lat, lng, radius, lang, limit, categories } = params;
    const [resp] = await this.client.searchNearby({
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius
        },
      },
      languageCode: lang,
      includedTypes: ['restaurant', ...(categories ? categories.split(',') : [])],
      maxResultCount: limit,
    },
      {
        otherArgs: { headers: { 'X-Goog-FieldMask': NEARBY_MASK } },
      },);
    return resp;
  }

  /** 店舗詳細API */
  async placeDetails(placeId: string, lang: string) {
    const [resp] = await this.client.getPlace({
      name: `places/${placeId}`,
      languageCode: lang,
    },
      {
        otherArgs: { headers: { 'X-Goog-FieldMask': DETAILS_MASK } },
      });
    return resp;
  }
}

