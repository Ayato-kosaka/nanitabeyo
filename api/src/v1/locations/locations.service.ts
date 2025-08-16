// api/src/v1/locations/locations.service.ts
//
// ❶ Google Places API との連携サービス
// ❷ Text Search API, Place Details API, Photo Media API を使用してレストラン情報を取得
// ❸ Autocomplete API を使用して地名候補を取得
//

import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../core/logger/logger.service';
import {
  AutocompleteLocationsResponse,
  LocationDetailsResponse,
} from '@shared/v1/res';
import { google } from '@googlemaps/places/build/protos/protos';
import {
  QueryAutocompleteLocationsDto,
  QueryLocationDetailsDto,
} from '@shared/v1/dto';
import { ExternalApiService } from 'src/core/external-api/external-api.service';
import { protos } from '@googlemaps/places';

@Injectable()
export class LocationsService {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly externalApiService: ExternalApiService,
  ) {}

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

    this.logger.debug('GoogleMapsTextSearch', 'searchRestaurants', params);

    // カテゴリに基づく検索クエリを構築
    const query = params.dishCategoryName;

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
      rankPreference: 'DISTANCE',
    };

    try {
      const response = await this.externalApiService.callPlaceSearchText(
        'places.id,places.displayName,places.location,contextualContents.photos.name,contextualContents.reviews.originalText,contextualContents.reviews.rating,contextualContents.reviews.authorAttribution',
        requestPayload,
      );

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
    try {
      const result = await this.externalApiService.getPhotoMedia(photoRef);

      if (result?.photoUri) {
        this.logger.debug('PhotoMediaDownloaded', 'getPhotoMedia', {
          photoUri: result.photoUri,
        });
        return result;
      }

      return null;
    } catch (error) {
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
    const requestPayload = {
      input: query.q,
      languageCode: query.languageCode,
      sessionToken: query.sessionToken,
    };

    try {
      const fieldMask =
        'suggestions.placePrediction.placeId,' +
        'suggestions.placePrediction.text,' +
        'suggestions.placePrediction.structuredFormat.mainText,' +
        'suggestions.placePrediction.structuredFormat.secondaryText,' +
        'suggestions.placePrediction.types';

      const response = await this.externalApiService.callPlacesAutocomplete(
        fieldMask,
        requestPayload,
      );

      const places = response.suggestions
        ?.map((suggestion) => ({
          place_id: suggestion.placePrediction?.placeId ?? '',
          text: suggestion.placePrediction?.text?.text ?? '',
          mainText:
            suggestion.placePrediction?.structuredFormat?.mainText?.text ?? '',
          secondaryText:
            suggestion.placePrediction?.structuredFormat?.secondaryText?.text ??
            '',
          types: suggestion.placePrediction?.types || [],
        }))
        .filter(
          (place) =>
            place.place_id !== '' &&
            place.text !== '' &&
            place.mainText !== '' &&
            place.secondaryText !== '',
        );

      if (!places) {
        this.logger.debug(
          'AutocompleteLocationsNoResults',
          'autocompleteLocations',
          {
            query,
          },
        );
        return [];
      }

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
   * Google Places API Details (New) を使用して地点の詳細情報を取得
   */
  async getLocationDetails(
    query: QueryLocationDetailsDto,
  ): Promise<LocationDetailsResponse> {
    try {
      const fieldMask = 'location,viewport,addressComponents,postalAddress';

      const response = await this.externalApiService.callPlaceDetails(
        fieldMask,
        query.placeId,
        query.languageCode,
        query.sessionToken,
      );

      if (
        !response.location ||
        !response.location.latitude ||
        !response.location.longitude ||
        !response.viewport ||
        !response.viewport.low ||
        !response.viewport.low.latitude ||
        !response.viewport.low.longitude ||
        !response.viewport.high ||
        !response.viewport.high.latitude ||
        !response.viewport.high.longitude ||
        !response.addressComponents ||
        response.addressComponents.some(
          (component) => !component.shortText || !component.types,
        )
      )
        throw new Error(
          'Invalid response from Google Places API: Missing required fields',
        );

      // location field from response
      const location = {
        latitude: response.location.latitude,
        longitude: response.location.longitude,
      };

      // viewport field from response
      const viewport = {
        low: {
          latitude: response.viewport.low.latitude,
          longitude: response.viewport.low.longitude,
        },
        high: {
          latitude: response.viewport.high.latitude,
          longitude: response.viewport.high.longitude,
        },
      };

      // Extract address from addressComponents
      const addressComponents = response.addressComponents;
      const relevantTypes = [
        'locality',
        'administrative_area_level_7',
        'administrative_area_level_6',
        'administrative_area_level_5',
        'administrative_area_level_4',
        'administrative_area_level_3',
        'administrative_area_level_2',
        'administrative_area_level_1',
        'country',
      ];

      const address = addressComponents
        .filter((component) =>
          component.types!.some((type) => relevantTypes.includes(type)),
        )
        .map((component) => component.longText)
        .filter(Boolean)
        .join(', ');

      // regionCode from addressComponents - extract country short text
      const countryComponent = addressComponents.find((component) =>
        component.types?.includes('country'),
      );
      const regionCode = countryComponent?.shortText;
      if (!regionCode)
        throw new Error(
          'Invalid response from Google Places API: Missing region code',
        );

      this.logger.debug('LocationDetailsSuccess', 'getLocationDetails', {
        placeId: query.placeId,
        location,
        viewport,
        address,
        regionCode,
      });

      return {
        location,
        viewport,
        address,
        regionCode,
      };
    } catch (error) {
      this.logger.error('GooglePlacesDetailsCallError', 'getLocationDetails', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        query,
      });
      throw error;
    }
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
}
