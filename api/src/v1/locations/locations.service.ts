// api/src/v1/locations/locations.service.ts
//
// ❶ Google Places API Autocomplete との連携
// ❷ 地名のみに絞り込む機能
//

import { Injectable } from '@nestjs/common';
import { env } from '../../core/config/env';
import { AppLoggerService } from '../../core/logger/logger.service';
import { AutocompleteLocationsResponse } from '@shared/v1/res';

// Google Places API Autocomplete のレスポンス型
interface GooglePlacesAutocompletePrediction {
  description: string;
  place_id: string;
  reference: string;
  matched_substrings: Array<{
    length: number;
    offset: number;
  }>;
  structured_formatting: {
    main_text: string;
    main_text_matched_substrings: Array<{
      length: number;
      offset: number;
    }>;
    secondary_text: string;
  };
  terms: Array<{
    offset: number;
    value: string;
  }>;
  types: string[];
}

interface GooglePlacesAutocompleteResponse {
  predictions: GooglePlacesAutocompletePrediction[];
  status: string;
  error_message?: string;
}

@Injectable()
export class LocationsService {
  constructor(private readonly logger: AppLoggerService) {}

  /**
   * Google Places API Autocomplete を使用して地名候補を取得
   */
  async autocompleteLocations(
    query: string,
  ): Promise<AutocompleteLocationsResponse> {
    this.logger.debug('AutocompleteLocations', 'autocompleteLocations', {
      query,
    });

    const apiKey = env.GOOGLE_PLACE_API_KEY;

    const url = new URL(
      'https://maps.googleapis.com/maps/api/place/autocomplete/json',
    );
    url.searchParams.set('input', query);
    url.searchParams.set('types', '(cities)'); // 地名のみに限定
    url.searchParams.set('language', 'ja'); // 日本語で結果を取得
    url.searchParams.set('key', apiKey);

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Google Places API request failed: ${response.status}`);
      }

      const data: GooglePlacesAutocompleteResponse = await response.json();

      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        this.logger.warn(
          'GooglePlacesAutocompleteError',
          'autocompleteLocations',
          {
            status: data.status,
            error_message: data.error_message,
          },
        );
        return [];
      }

      // レスポンス形式に変換
      const places = data.predictions.map((prediction) => ({
        place_id: prediction.place_id,
        description: prediction.description,
      }));

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
      return [];
    }
  }
}
