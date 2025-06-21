import { Injectable } from '@nestjs/common';
import { Client, PlacesNearbyResponseData, PlaceDetailsResponseData } from '@googlemaps/google-maps-services-js';
import { env } from '../../lib';

/**
 * 🌐 Google Places API を扱うサービス
 * - `@googlemaps/google-maps-services-js` ライブラリを利用してAPI呼び出しを行う
 */
@Injectable()
export class GooglePlacesService {
  private client = new Client({});

  /** 周辺検索API */
  async nearbySearch(params: {
    lat: number;
    lng: number;
    radius: number;
    lang: string;
    keyword?: string;
    pageToken?: string;
  }): Promise<PlacesNearbyResponseData> {
    const { lat, lng, radius, lang, keyword, pageToken } = params;
    const res = await this.client.placesNearby({
      params: {
        location: { lat, lng },
        radius,
        language: lang,
        keyword,
        pagetoken: pageToken,
        type: 'restaurant',
        key: env.API_GOOGLE_PLACE_API_KEY,
      },
      timeout: 1000,
    });
    return res.data;
  }

  /** 店舗詳細API */
  async placeDetails(placeId: string, lang: string): Promise<PlaceDetailsResponseData> {
    const res = await this.client.placeDetails({
      params: {
        place_id: placeId,
        language: lang,
        fields: [
          'place_id',
          'name',
          'vicinity',
          'geometry/location',
          'url',
          'rating',
          'user_ratings_total',
          'photo',
          'review',
        ],
        key: env.API_GOOGLE_PLACE_API_KEY,
      },
      timeout: 1000,
    });
    return res.data;
  }
}

