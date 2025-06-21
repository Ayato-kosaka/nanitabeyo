import { Injectable } from '@nestjs/common';
import { env } from '../../lib';

/**
 * 🌐 Google Places API を叩くユーティリティサービス
 */
@Injectable()
export class GooglePlacesService {
  private readonly NEARBY_SEARCH_URL =
    'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
  private readonly PLACE_DETAILS_URL =
    'https://maps.googleapis.com/maps/api/place/details/json';

  /**
   * 周辺検索APIを呼び出す
   */
  async nearbySearch(params: {
    lat: number;
    lng: number;
    radius: number;
    lang: string;
    keyword?: string;
    pageToken?: string;
  }): Promise<any> {
    const searchParams = new URLSearchParams({
      key: env.API_GOOGLE_PLACE_API_KEY,
      language: params.lang,
    });

    if (params.pageToken) {
      searchParams.set('pagetoken', params.pageToken);
    } else {
      searchParams.set('location', `${params.lat},${params.lng}`);
      searchParams.set('radius', String(params.radius));
      searchParams.set('type', 'restaurant');
      if (params.keyword) searchParams.set('keyword', params.keyword);
    }

    const res = await fetch(
      `${this.NEARBY_SEARCH_URL}?${searchParams.toString()}`,
    );
    if (!res.ok) {
      throw new Error(`NearbySearch failed: ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * 店舗詳細APIを呼び出す
   */
  async placeDetails(placeId: string, lang: string): Promise<any> {
    const detailsParams = new URLSearchParams({
      key: env.API_GOOGLE_PLACE_API_KEY,
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
      ].join(','),
    });
    const res = await fetch(
      `${this.PLACE_DETAILS_URL}?${detailsParams.toString()}`,
    );
    if (!res.ok) {
      throw new Error(`PlaceDetails failed: ${res.statusText}`);
    }
    return res.json();
  }
}
