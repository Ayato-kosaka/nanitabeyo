// api/src/v1/dishes/google-maps.service.ts
//
// Google Maps API との連携サービス
// Text Search API を使用してレストラン情報を取得
//

import { Injectable } from '@nestjs/common';
import { env } from '../../core/config/env';
import { AppLoggerService } from '../../core/logger/logger.service';

// Google Maps API のレスポンス型定義
interface GoogleMapsPhoto {
  height: number;
  html_attributions: string[];
  photo_reference: string;
  width: number;
}

interface GoogleMapsReview {
  author_name: string;
  author_url?: string;
  language: string;
  profile_photo_url?: string;
  rating: number;
  relative_time_description: string;
  text: string;
  time: number;
}

interface GoogleMapsGeometry {
  location: {
    lat: number;
    lng: number;
  };
  viewport: {
    northeast: {
      lat: number;
      lng: number;
    };
    southwest: {
      lat: number;
      lng: number;
    };
  };
}

export interface GoogleMapsPlace {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry: GoogleMapsGeometry;
  photos?: GoogleMapsPhoto[];
  reviews?: GoogleMapsReview[];
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  types: string[];
}

interface GoogleMapsTextSearchResponse {
  results: GoogleMapsPlace[];
  status: string;
  error_message?: string;
  next_page_token?: string;
}

@Injectable()
export class GoogleMapsService {
  constructor(private readonly logger: AppLoggerService) { }

  /**
   * Google Maps Text Search API を使用してレストランを検索
   */
  async searchRestaurants(
    location: string,
    radius: number,
    dishCategoryName: string,
  ): Promise<GoogleMapsPlace[]> {
    const [lat, lng] = location.split(',').map(Number);

    this.logger.debug('GoogleMapsTextSearch', 'searchRestaurants', {
      location: `${lat},${lng}`,
      radius,
      category: dishCategoryName,
    });

    const apiKey = env.GOOGLE_PLACE_API_KEY;

    // カテゴリに基づく検索クエリを構築
    const query = dishCategoryName;

    const url = new URL(
      'https://maps.googleapis.com/maps/api/place/textsearch/json',
    );
    url.searchParams.set('query', query);
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', radius.toString());
    url.searchParams.set('type', 'restaurant');
    url.searchParams.set('key', apiKey);

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Google Maps API request failed: ${response.status}`);
      }

      const data: GoogleMapsTextSearchResponse = await response.json();

      if (data.status !== 'OK') {
        this.logger.warn('GoogleMapsAPIError', 'searchRestaurants', {
          status: data.status,
          error_message: data.error_message,
        });
        return [];
      }

      this.logger.debug('GoogleMapsTextSearchSuccess', 'searchRestaurants', {
        resultCount: data.results.length,
      });

      return data.results;
    } catch (error) {
      this.logger.error('GoogleMapsAPICallError', 'searchRestaurants', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        location,
        radius,
        category: dishCategoryName,
      });
      return [];
    }
  }

  /**
   * Place Details API を使用して詳細情報（レビュー、写真）を取得
   */
  private async getPlaceDetails(
    places: GoogleMapsPlace[],
  ): Promise<GoogleMapsPlace[]> {
    const apiKey = env.GOOGLE_PLACE_API_KEY;
    const detailedPlaces: GoogleMapsPlace[] = [];

    for (const place of places.slice(0, 10)) {
      // 最大10件に制限
      try {
        const url = new URL(
          'https://maps.googleapis.com/maps/api/place/details/json',
        );
        url.searchParams.set('place_id', place.place_id);
        url.searchParams.set(
          'fields',
          'place_id,name,formatted_address,geometry,photos,reviews,rating,user_ratings_total,price_level,types',
        );
        url.searchParams.set('key', apiKey);

        const response = await fetch(url.toString());

        if (!response.ok) {
          this.logger.warn('PlaceDetailsAPIError', 'getPlaceDetails', {
            placeId: place.place_id,
            status: response.status,
          });
          continue;
        }

        const data = await response.json();

        if (data.status === 'OK' && data.result) {
          detailedPlaces.push(data.result);
        }
      } catch (error) {
        this.logger.warn('PlaceDetailsError', 'getPlaceDetails', {
          placeId: place.place_id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return detailedPlaces;
  }
}
