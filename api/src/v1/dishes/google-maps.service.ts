// api/src/v1/dishes/google-maps.service.ts
//
// Google Maps API との連携サービス
// Text Search API を使用してレストラン情報を取得
//

import { Injectable } from '@nestjs/common';
import { PlacesClient } from '@googlemaps/places';
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
  private readonly placesClient: PlacesClient;

  constructor(private readonly logger: AppLoggerService) {
    // Initialize PlacesClient with API key authentication
    this.placesClient = new PlacesClient({
      apiKey: env.GOOGLE_PLACE_API_KEY,
      fallback: true, // Use REST API instead of gRPC
    });
  }

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

    // カテゴリに基づく検索クエリを構築
    const query = dishCategoryName;

    const startTime = Date.now();
    const requestPayload = {
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius,
        },
      },
    };

    try {
      // PlacesClient を使用してテキスト検索
      const [response] = await this.placesClient.searchText(requestPayload);

      const responseTime = Date.now() - startTime;

      // 外部API呼び出しログを記録
      await this.logger.externalApi({
        function_name: 'searchRestaurants',
        api_name: 'Google Places API',
        endpoint: 'places.searchText',
        method: 'POST',
        request_payload: JSON.stringify(requestPayload),
        response_payload: JSON.stringify(response),
        status_code: 200,
        response_time_ms: responseTime,
        error_message: null,
      });

      if (!response.places || response.places.length === 0) {
        this.logger.debug(
          'GoogleMapsTextSearchNoResults',
          'searchRestaurants',
          {
            resultCount: 0,
          },
        );
        return [];
      }

      // PlacesAPIのレスポンスを既存のGoogleMapsPlace形式に変換
      const places: GoogleMapsPlace[] = response.places.map((place) => ({
        place_id: place.id || '',
        name: place.displayName?.text || '',
        formatted_address: place.formattedAddress || '',
        geometry: {
          location: {
            lat: place.location?.latitude || 0,
            lng: place.location?.longitude || 0,
          },
          viewport: {
            northeast: {
              lat: place.viewport?.high?.latitude || 0,
              lng: place.viewport?.high?.longitude || 0,
            },
            southwest: {
              lat: place.viewport?.low?.latitude || 0,
              lng: place.viewport?.low?.longitude || 0,
            },
          },
        },
        photos: place.photos?.map((photo) => ({
          height: photo.heightPx || 0,
          width: photo.widthPx || 0,
          photo_reference: photo.name || '',
          html_attributions:
            photo.authorAttributions?.map((attr) => attr.displayName || '') ||
            [],
        })),
        reviews: place.reviews?.map((review) => ({
          author_name: review.authorAttribution?.displayName || '',
          author_url: review.authorAttribution?.uri || '',
          language: review.originalText?.languageCode || '',
          profile_photo_url: review.authorAttribution?.photoUri || '',
          rating: review.rating || 0,
          relative_time_description:
            review.relativePublishTimeDescription || '',
          text: review.originalText?.text || '',
          time: this.parseTimestamp(review.publishTime),
        })),
        rating: place.rating || undefined,
        user_ratings_total: place.userRatingCount || undefined,
        price_level: this.convertPriceLevel(place.priceLevel),
        types: place.types || [],
      }));

      this.logger.debug('GoogleMapsTextSearchSuccess', 'searchRestaurants', {
        resultCount: places.length,
      });

      return places;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // エラー時も外部API呼び出しログを記録
      await this.logger.externalApi({
        function_name: 'searchRestaurants',
        api_name: 'Google Places API',
        endpoint: 'places.searchText',
        method: 'POST',
        request_payload: JSON.stringify(requestPayload),
        response_payload: null,
        status_code: 500,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        response_time_ms: responseTime,
      });

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
    const detailedPlaces: GoogleMapsPlace[] = [];

    for (const place of places.slice(0, 10)) {
      // 最大10件に制限
      const startTime = Date.now();
      const requestPayload = {
        name: `places/${place.place_id}`,
        fieldMask:
          'id,displayName,formattedAddress,location,viewport,photos,reviews,rating,userRatingCount,priceLevel,types',
      };

      try {
        // PlacesClient を使用して詳細情報を取得
        const [response] = await this.placesClient.getPlace(requestPayload);

        const responseTime = Date.now() - startTime;

        // 外部API呼び出しログを記録
        await this.logger.externalApi({
          function_name: 'getPlaceDetails',
          api_name: 'Google Places API',
          endpoint: 'places.getPlace',
          method: 'POST',
          request_payload: JSON.stringify(requestPayload),
          response_payload: JSON.stringify(response),
          status_code: 200,
          response_time_ms: responseTime,
          error_message: null,
        });

        if (response) {
          // PlacesAPIのレスポンスを既存のGoogleMapsPlace形式に変換
          const detailedPlace: GoogleMapsPlace = {
            place_id: response.id || place.place_id,
            name: response.displayName?.text || place.name,
            formatted_address:
              response.formattedAddress || place.formatted_address,
            geometry: {
              location: {
                lat: response.location?.latitude || place.geometry.location.lat,
                lng:
                  response.location?.longitude || place.geometry.location.lng,
              },
              viewport: {
                northeast: {
                  lat:
                    response.viewport?.high?.latitude ||
                    place.geometry.viewport.northeast.lat,
                  lng:
                    response.viewport?.high?.longitude ||
                    place.geometry.viewport.northeast.lng,
                },
                southwest: {
                  lat:
                    response.viewport?.low?.latitude ||
                    place.geometry.viewport.southwest.lat,
                  lng:
                    response.viewport?.low?.longitude ||
                    place.geometry.viewport.southwest.lng,
                },
              },
            },
            photos:
              response.photos?.map((photo) => ({
                height: photo.heightPx || 0,
                width: photo.widthPx || 0,
                photo_reference: photo.name || '',
                html_attributions:
                  photo.authorAttributions?.map(
                    (attr) => attr.displayName || '',
                  ) || [],
              })) || place.photos,
            reviews:
              response.reviews?.map((review) => ({
                author_name: review.authorAttribution?.displayName || '',
                author_url: review.authorAttribution?.uri || '',
                language: review.originalText?.languageCode || '',
                profile_photo_url: review.authorAttribution?.photoUri || '',
                rating: review.rating || 0,
                relative_time_description:
                  review.relativePublishTimeDescription || '',
                text: review.originalText?.text || '',
                time: this.parseTimestamp(review.publishTime),
              })) || place.reviews,
            rating: response.rating || place.rating,
            user_ratings_total:
              response.userRatingCount || place.user_ratings_total,
            price_level:
              this.convertPriceLevel(response.priceLevel) ||
              this.convertPriceLevel(place.price_level),
            types: response.types || place.types,
          };

          detailedPlaces.push(detailedPlace);
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;

        // エラー時も外部API呼び出しログを記録
        await this.logger.externalApi({
          function_name: 'getPlaceDetails',
          api_name: 'Google Places API',
          endpoint: 'places.getPlace',
          method: 'POST',
          request_payload: JSON.stringify(requestPayload),
          response_payload: null,
          status_code: 500,
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          response_time_ms: responseTime,
        });

        this.logger.warn('PlaceDetailsError', 'getPlaceDetails', {
          placeId: place.place_id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return detailedPlaces;
  }

  /**
   * 写真のメディアデータを取得
   */
  async getPhotoMedia(photoRef: string): Promise<Buffer | null> {
    const startTime = Date.now();
    const requestPayload = {
      name: photoRef,
      maxWidthPx: 800,
    };

    try {
      // PlacesClient を使用して写真メディアを取得
      const [response] = await this.placesClient.getPhotoMedia(requestPayload);

      const responseTime = Date.now() - startTime;

      // 外部API呼び出しログを記録
      await this.logger.externalApi({
        function_name: 'getPhotoMedia',
        api_name: 'Google Places API',
        endpoint: 'places.getPhotoMedia',
        method: 'POST',
        request_payload: JSON.stringify(requestPayload),
        response_payload: 'Binary media data',
        status_code: 200,
        response_time_ms: responseTime,
        error_message: null,
      });

      // IPhotoMedia から実際のバイナリデータを取得
      // Note: 実際のバイナリデータ取得はresponse内のphotoUriを使って追加のHTTP呼び出しが必要な場合があります
      if (response.photoUri) {
        // photoUriから実際の画像データを取得
        const imageResponse = await fetch(response.photoUri);
        if (imageResponse.ok) {
          const arrayBuffer = await imageResponse.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }
      }

      return null;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // エラー時も外部API呼び出しログを記録
      await this.logger.externalApi({
        function_name: 'getPhotoMedia',
        api_name: 'Google Places API',
        endpoint: 'places.getPhotoMedia',
        method: 'POST',
        request_payload: JSON.stringify(requestPayload),
        response_payload: null,
        status_code: 500,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        response_time_ms: responseTime,
      });

      this.logger.warn('PhotoMediaError', 'getPhotoMedia', {
        photoRef,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return null;
    }
  }

  /**
   * PriceLevel enum を number に変換
   */
  private convertPriceLevel(priceLevel: any): number | undefined {
    if (!priceLevel) return undefined;

    // String または number の場合の処理
    if (typeof priceLevel === 'string') {
      switch (priceLevel) {
        case 'PRICE_LEVEL_FREE':
          return 0;
        case 'PRICE_LEVEL_INEXPENSIVE':
          return 1;
        case 'PRICE_LEVEL_MODERATE':
          return 2;
        case 'PRICE_LEVEL_EXPENSIVE':
          return 3;
        case 'PRICE_LEVEL_VERY_EXPENSIVE':
          return 4;
        default:
          return undefined;
      }
    }

    // すでに number の場合
    if (typeof priceLevel === 'number') {
      return priceLevel >= 0 && priceLevel <= 4 ? priceLevel : undefined;
    }

    return undefined;
  }

  /**
   * ITimestamp または string を UNIX timestamp (seconds) に変換
   */
  private parseTimestamp(timestamp: any): number {
    if (!timestamp) return 0;

    // ITimestamp オブジェクトの場合
    if (typeof timestamp === 'object' && timestamp.seconds) {
      return Number(timestamp.seconds);
    }

    // 文字列の場合
    if (typeof timestamp === 'string') {
      return Math.floor(Date.parse(timestamp) / 1000) || 0;
    }

    // 数値の場合
    if (typeof timestamp === 'number') {
      return timestamp;
    }

    return 0;
  }
}
