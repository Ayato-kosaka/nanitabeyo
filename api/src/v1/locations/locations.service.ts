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
  LocationReverseGeocodingResponse,
} from '@shared/v1/res';
import { google } from '@googlemaps/places/build/protos/protos';
import {
  QueryAutocompleteLocationsDto,
  QueryLocationDetailsDto,
  QueryReverseGeocodingDto,
} from '@shared/v1/dto';
import { ExternalApiService } from 'src/core/external-api/external-api.service';
import { protos } from '@googlemaps/places';

// Import language dictionaries
import * as territoryLanguages from './territory_languages.json';
import * as subterritoryOverrides from './subterritory_overrides.json';

// Interface definitions for language dictionaries
interface TerritoryLanguage {
  territory: string;
  lang: string;
  weight: number;
  script: string;
  notes: string;
}

interface SubterritoryOverride {
  sub: string;
  primary_lang: string;
  script: string;
  fallback_list: string[];
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly externalApiService: ExternalApiService,
  ) {}

  /**
   * addressComponents から国コード (ISO-2) と州コード (ISO-3166-2) を抽出
   */
  private extractLocationCodes(
    addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[],
  ): {
    countryCode: string | null;
    subterritoryCode: string | null;
  } {
    const countryComponent = addressComponents.find((component) =>
      component.types?.includes('country'),
    );
    const adminLevel1Component = addressComponents.find((component) =>
      component.types?.includes('administrative_area_level_1'),
    );

    const countryCode = countryComponent?.shortText || null;
    let subterritoryCode: string | null = null;

    if (countryCode && adminLevel1Component?.shortText) {
      // ISO-3166-2 形式 (例: CH-GE, ES-CT) に変換
      subterritoryCode = `${countryCode}-${adminLevel1Component.shortText}`;
    }

    return { countryCode, subterritoryCode };
  }

  /**
   * 言語候補リストを生成（州上書き → 国レベル → 英語フォールバック）
   */
  private buildLanguageCandidates(
    countryCode: string,
    subterritoryCode: string | null,
  ): string[] {
    const candidates: string[] = [];

    // 1. 州/県での上書きを最優先
    if (subterritoryCode) {
      const override = (subterritoryOverrides as SubterritoryOverride[]).find(
        (item) => item.sub === subterritoryCode,
      );
      if (override) {
        candidates.push(override.primary_lang);
        if (override.fallback_list?.length > 0) {
          candidates.push(...override.fallback_list);
        }
      }
    }

    // 2. 国の重み順を後ろに追加（重複排除）
    const territoryLangs = (territoryLanguages as TerritoryLanguage[])
      .filter((item) => item.territory === countryCode)
      .sort((a, b) => b.weight - a.weight);

    for (const item of territoryLangs) {
      const langCode = item.script ? `${item.lang}-${item.script}` : item.lang;
      if (!candidates.includes(langCode)) {
        candidates.push(langCode);
      }
    }

    // 3. 最後に英語フォールバック
    if (!candidates.includes('en')) {
      candidates.push('en');
    }

    return candidates;
  }

  /**
   * addressComponents から最適な言語コードを解決
   */
  private resolveLocalLanguageCode(
    addressComponents: protos.google.maps.places.v1.Place.IAddressComponent[],
  ): string {
    const { countryCode, subterritoryCode } =
      this.extractLocationCodes(addressComponents);

    if (!countryCode) {
      this.logger.warn('CountryCodeNotFound', 'resolveLocalLanguageCode', {
        addressComponents,
      });
      return 'en'; // フォールバック
    }

    const candidates = this.buildLanguageCandidates(
      countryCode,
      subterritoryCode,
    );

    this.logger.debug('LanguageResolution', 'resolveLocalLanguageCode', {
      countryCode,
      subterritoryCode,
      candidates,
    });

    // 最初の候補を採用
    return candidates[0] || 'en';
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
    priceLevels?: string[];
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
      // priceLevels は string 配列なので、型チェックを回避するためにキャスト
      ...(params.priceLevels && {
        priceLevels: params.priceLevels.map(
          (level) =>
            level as unknown as protos.google.maps.places.v1.PriceLevel,
        ),
      }),
      rankPreference: 'DISTANCE',
    };

    try {
      const response = await this.externalApiService.callPlaceSearchText(
        'places.id,places.displayName,places.location,contextualContents.photos.name,contextualContents.photos.widthPx,contextualContents.photos.heightPx,contextualContents.reviews.originalText,contextualContents.reviews.rating,contextualContents.reviews.authorAttribution',
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
  async getPhotoMedia(
    photoRef: string,
    widthPx?: number,
    heightPx?: number,
  ): Promise<{ photoUri: string } | null> {
    try {
      const result = await this.externalApiService.getPhotoMedia(
        photoRef,
        widthPx,
        heightPx,
      );

      if (result?.photoUri) {
        this.logger.debug('PhotoMediaDownloaded', 'getPhotoMedia', {
          photoUri: result.photoUri,
          widthPx,
          heightPx,
        });
        return result;
      }

      return null;
    } catch (error) {
      this.logger.warn('PhotoMediaError', 'getPhotoMedia', {
        photoRef,
        widthPx,
        heightPx,
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

      return places;
    } catch (error) {
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
      const fieldMask = 'location,viewport,addressComponents';

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
      const address = this.buildAddressFromComponents(addressComponents);

      // Resolve local language code from addressComponents
      const localLanguageCode =
        this.resolveLocalLanguageCode(addressComponents);

      this.logger.debug('LocationDetailsSuccess', 'getLocationDetails', {
        placeId: query.placeId,
        location,
        viewport,
        address,
        localLanguageCode,
      });

      return {
        location,
        viewport,
        address,
        localLanguageCode,
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
   * Google Geocoding API を使用した逆ジオコーディング
   */
  async getReverseGeocoding(
    query: QueryReverseGeocodingDto,
  ): Promise<LocationReverseGeocodingResponse> {
    try {
      const response = await this.externalApiService.callReverseGeocoding(
        query.lat,
        query.lng,
        'en', // Fixed to 'en' as per requirements
      );

      if (!response.results || response.results.length === 0) {
        throw new Error('No geocoding results found');
      }

      const result = response.results[0];

      if (
        !result.geometry?.location?.lat ||
        !result.geometry?.location?.lng ||
        !result.geometry?.viewport?.southwest?.lat ||
        !result.geometry?.viewport?.southwest?.lng ||
        !result.geometry?.viewport?.northeast?.lat ||
        !result.geometry?.viewport?.northeast?.lng ||
        !result.address_components
      )
        throw new Error(
          'Invalid geocoding result: Missing location coordinates',
        );

      const location = {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
      };

      // viewport field from response
      const viewport = {
        low: {
          latitude: result.geometry.viewport.southwest.lat,
          longitude: result.geometry.viewport.southwest.lng,
        },
        high: {
          latitude: result.geometry.viewport.northeast.lat,
          longitude: result.geometry.viewport.northeast.lng,
        },
      };

      // Extract address from addressComponents
      const addressComponents = result.address_components.map((component) => ({
        shortText: component.short_name,
        longText: component.long_name,
        types: component.types || [],
      }));
      const address = this.buildAddressFromComponents(addressComponents);

      // Resolve local language code from addressComponents
      const localLanguageCode =
        this.resolveLocalLanguageCode(addressComponents);

      return {
        location,
        viewport,
        address,
        localLanguageCode,
      };
    } catch (error) {
      this.logger.error('GoogleGeocodingReverseError', 'getReverseGeocoding', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        query,
      });
      throw error;
    }
  }

  /**
   * Build address from address components (locality and above)
   */
  private buildAddressFromComponents(
    addressComponents: google.maps.places.v1.Place.IAddressComponent[],
  ): string {
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

    return address;
  }
}
