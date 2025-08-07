// api/src/v1/dishes/google-maps.service.ts
//
// Google Maps API との連携サービス
// Text Search API を使用してレストラン情報を取得
//

import { Injectable } from '@nestjs/common';
import { PlacesClient } from '@googlemaps/places';
import { env } from '../../core/config/env';
import { AppLoggerService } from '../../core/logger/logger.service';
import { google } from '@googlemaps/places/build/protos/protos';

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
  ): Promise<google.maps.places.v1.ISearchTextResponse> {
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
        return {};
      }

      this.logger.debug('GoogleMapsTextSearchSuccess', 'searchRestaurants', {
        resultCount: response.places?.length,
      });

      return response;
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
      return {};
    }
  }

  /**
   * 写真の参照を使用して、Google Places API から写真の URI を取得
   */
  async getPhotoMedia(photoRef: string): Promise<{ photoUri: string, buffer: Buffer } | null> {
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
          return {
            photoUri: response.photoUri,
            buffer: Buffer.from(arrayBuffer)
          }
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
