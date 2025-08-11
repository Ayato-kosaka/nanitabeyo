// api/src/v1/locations/locations.service.ts
//
// ❶ Google Places API との連携サービス
// ❷ Text Search API, Place Details API, Photo Media API を使用してレストラン情報を取得
// ❸ Autocomplete API を使用して地名候補を取得
//

import { Injectable } from '@nestjs/common';
import { PlacesClient, protos } from '@googlemaps/places';
import { env } from '../../core/config/env';
import { AppLoggerService } from '../../core/logger/logger.service';
import { AutocompleteLocationsResponse } from '@shared/v1/res';
import { google } from '@googlemaps/places/build/protos/protos';
import { last } from 'rxjs';
import { QueryAutocompleteLocationsDto } from '@shared/v1/dto';

@Injectable()
export class LocationsService {
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
  async searchRestaurants(params: {
    location: string;
    radius: number;
    dishCategoryName: string;
    minRating?: number;
    languageCode?: string;
    priceLevels?: number[];
    pageSize?: number;
  }): Promise<google.maps.places.v1.ISearchTextResponse> {
    const [lat, lng] = params.location.split(',').map(Number);

    this.logger.debug('GoogleMapsTextSearch', 'searchRestaurants', {
      location: `${lat},${lng}`,
      radius: params.radius,
      category: params.dishCategoryName,
      params,
    });

    // カテゴリに基づく検索クエリを構築
    const query = params.dishCategoryName;

    const startTime = Date.now();
    const requestPayload: protos.google.maps.places.v1.ISearchTextRequest = {
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: params.radius,
        },
      },
      ...(params.pageSize && { pageSize: params.pageSize }),
      ...(params.minRating && { minRating: params.minRating }),
      ...(params.languageCode && { languageCode: params.languageCode }),
      ...(params.priceLevels && {
        priceLevels: params.priceLevels
          .map((level) => this.numberToPriceLevel(level))
          .filter((level) => level !== undefined),
      }),
    };

    try {
      // PlacesClient を使用してテキスト検索
      const [response] = await this.placesClient.searchText(requestPayload, {
        otherArgs: {
          headers: {
            'X-Goog-FieldMask':
              'places.id,places.name,places.location,places.reviews,contextualContents.photos.name,contextualContents.reviews',
          },
        },
      });

      const responseTime = Date.now() - startTime;

      // 外部API呼び出しログを記録
      await this.logger.externalApi({
        function_name: 'searchRestaurants',
        api_name: 'Google Places Text Search API',
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
        api_name: 'Google Places Text Search API',
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
        location: params.location,
        radius: params.radius,
        category: params.dishCategoryName,
      });

      throw error;
    }
  }

  /**
   * 写真の参照を使用して、Google Places API から写真の URI を取得
   */
  async getPhotoMedia(photoRef: string): Promise<{ photoUri: string } | null> {
    const startTime = Date.now();
    const photoName = photoRef.endsWith('/media')
      ? photoRef
      : `${photoRef}/media`;
    const requestPayload = {
      name: photoName,
      maxWidthPx: 800,
      skipHttpRedirect: true,
    };

    try {
      // PlacesClient を使用して写真メディアを取得
      const [response] = await this.placesClient.getPhotoMedia(requestPayload);

      const responseTime = Date.now() - startTime;

      // 外部API呼び出しログを記録
      await this.logger.externalApi({
        function_name: 'getPhotoMedia',
        api_name: 'Google Places Photos API',
        endpoint: 'places.getPhotoMedia',
        method: 'POST',
        request_payload: JSON.stringify(requestPayload),
        response_payload: response.photoUri ?? null,
        status_code: 200,
        response_time_ms: responseTime,
        error_message: null,
      });

      // IPhotoMediaUri から photoUri のみを返却（バイナリ取得は非同期ジョブで実行）
      if (response.photoUri) {
        return {
          photoUri: response.photoUri,
        };
      }

      return null;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // エラー時も外部API呼び出しログを記録
      await this.logger.externalApi({
        function_name: 'getPhotoMedia',
        api_name: 'Google Places Photos API',
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

      throw error;
    }
  }

  /**
   * 写真URIから実際のバイナリデータをダウンロード（非同期ジョブ用）
   */
  async downloadPhotoData(photoUri: string): Promise<{ data: Buffer }> {
    try {
      // Google Maps Photo API から実際のバイナリデータを取得
      // 注: 実際の実装では HTTP クライアントを使用して photoUri から画像をダウンロード
      const response = await fetch(photoUri);
      if (!response.ok) {
        throw new Error(`Failed to download photo: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      this.logger.debug('PhotoDataDownloaded', 'downloadPhotoData', {
        photoUri,
        dataSize: buffer.length,
      });

      return { data: buffer };
    } catch (error) {
      this.logger.error('PhotoDataDownloadError', 'downloadPhotoData', {
        photoUri,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Google Places API Autocomplete を使用して地名候補を取得
   */
  async autocompleteLocations(
    query: QueryAutocompleteLocationsDto,
  ): Promise<AutocompleteLocationsResponse> {
    this.logger.debug('AutocompleteLocations', 'autocompleteLocations', {
      query,
    });

    const startTime = Date.now();
    const requestPayload = {
      input: query.q,
      types: ['(cities)'], // 地名のみに限定
      languageCode: query.languageCode,
    };

    try {
      const response =
        await this.placesClient.autocompletePlaces(requestPayload);

      // 外部API呼び出しログを記録
      await this.logger.externalApi({
        function_name: 'autocompleteLocations',
        api_name: 'Google Places Autocomplete API',
        endpoint: 'places.autocompletePlaces',
        method: 'POST',
        request_payload: JSON.stringify(requestPayload),
        response_payload: JSON.stringify(response),
        status_code: 200,
        response_time_ms: Date.now() - startTime,
        error_message: null,
      });
      // レスポンス形式に変換
      const places = response[0].suggestions
        ?.map((suggestion) => ({
          place_id: suggestion.placePrediction?.placeId,
          text: suggestion.placePrediction?.text?.text,
          mainText: suggestion.placePrediction?.structuredFormat?.mainText,
          secondaryText:
            suggestion.placePrediction?.structuredFormat?.secondaryText,
          types: suggestion.placePrediction?.types || [],
        }))
        .filter(
          (place) =>
            place.place_id &&
            place.text &&
            place.mainText &&
            place.secondaryText,
        ) as AutocompleteLocationsResponse;
      this.logger.debug(
        'AutocompleteLocationsSuccess',
        'autocompleteLocations',
        {
          query,
          resultCount: places.length,
        },
      );

      return places;
    } catch (error) {
      this.logger.error(
        'GooglePlacesAutocompleteCallError',
        'autocompleteLocations',
        {
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          query,
        },
      );

      throw error;
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
   * number を Google Maps PriceLevel enum に変換
   */
  private numberToPriceLevel(
    level: number,
  ): protos.google.maps.places.v1.PriceLevel | undefined {
    switch (level) {
      case 2:
        return protos.google.maps.places.v1.PriceLevel.PRICE_LEVEL_INEXPENSIVE;
      case 3:
        return protos.google.maps.places.v1.PriceLevel.PRICE_LEVEL_MODERATE;
      case 4:
        return protos.google.maps.places.v1.PriceLevel.PRICE_LEVEL_EXPENSIVE;
      case 5:
        return protos.google.maps.places.v1.PriceLevel
          .PRICE_LEVEL_VERY_EXPENSIVE;
      default:
        return undefined;
    }
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
