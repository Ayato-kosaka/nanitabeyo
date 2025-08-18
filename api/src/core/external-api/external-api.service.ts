// api/src/core/external-api/external-api.service.ts
//
// External API service for Wikidata, Google Custom Search, and Claude API
//

import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { CreateExternalApiInput } from '../logger/logger.types';
import { google } from '@googlemaps/places/build/protos/protos';
import { InputJsonValue } from '../../../../shared/prisma/runtime/library';

// Wikidata API のレスポンス型
interface WikidataSearchResponse {
  search: {
    id: string;
    label: string;
    description?: string;
  }[];
}

// Google Custom Search API のレスポンス型
interface GoogleCustomSearchResponse {
  spelling?: {
    correctedQuery: string;
  };
}

// Claude API のレスポンス型
interface ClaudeMessageResponse {
  id: string;
  model: string;
  role: 'assistant';
  type: 'message';
  content: {
    type: 'text';
    text: string;
  }[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

@Injectable()
export class ExternalApiService {
  constructor(private readonly logger: AppLoggerService) {}

  /**
   * Claude API呼び出し
   */
  async callClaudeAPI(payload: any): Promise<ClaudeMessageResponse> {
    const claudeApiKey = env.CLAUDE_API_KEY;

    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY is not configured');
    }

    const endpoint = 'https://api.anthropic.com/v1/messages';

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Claude API',
        endpoint,
        method: 'POST',
        request_payload: payload,
        function_name: 'callClaudeAPI',
        customHeaders: {
          'anthropic-version': '2023-06-01',
          'x-api-key': claudeApiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Claude API request failed: ${response.status} ${errorText}`,
        );
      }

      const responseData = await response.json();
      return responseData;
    } catch (error) {
      this.logger.error('ClaudeAPICallError', 'callClaudeAPI', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        request_payload: payload,
      });
      throw error;
    }
  }

  /**
   * Wikidata で料理カテゴリを検索
   */
  async searchWikidata(
    query: string,
  ): Promise<{ qid: string; label: string } | null> {
    this.logger.debug('searchWikidata', 'searchWikidata', {
      query,
    });

    const endpoint = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=ja&type=item&limit=1&search=${encodeURIComponent(query)}`;

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Wikidata API',
        endpoint,
        method: 'GET',
        request_payload: {},
        function_name: 'searchWikidata',
      });

      if (!response.ok) {
        throw new Error(`Wikidata API request failed: ${response.status}`);
      }

      const data: WikidataSearchResponse = await response.json();

      if (data.search && data.search.length > 0) {
        const result = data.search[0];
        this.logger.debug('searchWikidata', 'searchWikidata', {
          qid: result.id,
          label: result.label,
        });
        return { qid: result.id, label: result.label };
      }

      this.logger.debug('searchWikidata', 'searchWikidata', {
        message: 'No results found',
      });
      return null;
    } catch (error) {
      this.logger.error('WikidataAPICallError', 'searchWikidata', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        query,
      });
      return null;
    }
  }

  /**
   * Google Custom Search で料理カテゴリのスペルチェック
   */
  async getCorrectedSpelling(query: string): Promise<string | null> {
    this.logger.debug('getCorrectedSpelling', 'getCorrectedSpelling', {
      query,
    });

    const googleApiKey = env.GOOGLE_API_KEY;
    const searchEngineId = env.GOOGLE_SEARCH_ENGINE_ID;

    if (!googleApiKey || !searchEngineId) {
      this.logger.warn('getCorrectedSpelling', 'getCorrectedSpelling', {
        error_message: 'Google API credentials are not configured',
      });
      return null;
    }

    const endpoint = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Google Custom Search API',
        endpoint,
        method: 'GET',
        function_name: 'getCorrectedSpelling',
        request_payload: {},
      });

      if (!response.ok) {
        throw new Error(
          `Google Custom Search API request failed: ${response.status}`,
        );
      }

      const data: GoogleCustomSearchResponse = await response.json();

      if (data.spelling?.correctedQuery) {
        this.logger.debug('getCorrectedSpelling', 'getCorrectedSpelling', {
          correctedQuery: data.spelling.correctedQuery,
        });
        return data.spelling.correctedQuery;
      }

      this.logger.debug('getCorrectedSpelling', 'getCorrectedSpelling', {
        message: 'No spelling correction found',
      });
      return null;
    } catch (error) {
      this.logger.error(
        'GoogleCustomSearchAPICallError',
        'getCorrectedSpelling',
        {
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          query,
        },
      );
      return null;
    }
  }

  /**
   * Google Places API: Text Search
   */
  async callPlaceSearchText(
    fieldMask: string,
    payload: google.maps.places.v1.ISearchTextRequest,
  ): Promise<google.maps.places.v1.ISearchTextResponse> {
    const apiKey = env.GOOGLE_PLACE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_PLACE_API_KEY is not configured');
    }

    const endpoint = 'https://places.googleapis.com/v1/places:searchText';

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Google Places Text Search API',
        endpoint,
        method: 'POST',
        request_payload: payload as NonNullable<InputJsonValue>,
        function_name: 'callPlaceSearchText',
        customHeaders: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Google Places Text Search API request failed: ${response.status} ${errorText}`,
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      this.logger.error('GooglePlacesAPICallError', 'callPlaceSearchText', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        fieldMask,
        request_payload: payload,
      });
      throw error;
    }
  }

  /**
   * Google Places API: Get Photo Media (JSON with photoUri)
   */
  async getPhotoMedia(photoRef: string): Promise<{ photoUri: string } | null> {
    const apiKey = env.GOOGLE_PLACE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_PLACE_API_KEY is not configured');
    }

    const photoName = photoRef.endsWith('/media')
      ? photoRef
      : `${photoRef}/media`;
    const endpoint = `https://places.googleapis.com/v1/${photoName}?maxWidthPx=800&skipHttpRedirect=true`;

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Google Places Photos API',
        endpoint,
        method: 'GET',
        request_payload: {},
        function_name: 'getPhotoMedia',
        customHeaders: {
          'X-Goog-Api-Key': apiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Google Places Photos API request failed: ${response.status} ${errorText}`,
        );
      }

      const data = await response.json().catch(() => null);
      if (data?.photoUri) {
        return { photoUri: data.photoUri };
      }
      return null;
    } catch (error) {
      this.logger.error('GooglePlacesPhotosAPICallError', 'getPhotoMedia', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        photoRef,
      });
      throw error;
    }
  }

  /**
   * Google Places API: Autocomplete
   */
  async callPlacesAutocomplete(
    fieldMask: string,
    payload: google.maps.places.v1.IAutocompletePlacesRequest,
  ): Promise<google.maps.places.v1.IAutocompletePlacesResponse> {
    const apiKey = env.GOOGLE_PLACE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_PLACE_API_KEY is not configured');
    }

    const endpoint = 'https://places.googleapis.com/v1/places:autocomplete';

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Google Places Autocomplete API',
        endpoint,
        method: 'POST',
        request_payload: payload as NonNullable<InputJsonValue>,
        function_name: 'callPlacesAutocomplete',
        customHeaders: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        skipLogging: true, // Skip logging for autocomplete to reduce noise
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Google Places Autocomplete API request failed: ${response.status} ${errorText}`,
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      this.logger.error(
        'GooglePlacesAutocompleteAPICallError',
        'callPlacesAutocomplete',
        {
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          request_payload: payload,
          fieldMask,
        },
      );
      throw error;
    }
  }

  /**
   * Google Places API: Place Details (New)
   */
  async callPlaceDetails(
    fieldMask: string,
    placeId: string,
    languageCode: string,
    sessionToken?: string,
  ): Promise<google.maps.places.v1.IPlace> {
    const apiKey = env.GOOGLE_PLACE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_PLACE_API_KEY is not configured');
    }

    const endpoint = `https://places.googleapis.com/v1/places/${placeId}`;

    try {
      const headers: Record<string, string> = {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      };

      if (sessionToken) {
        headers['X-Goog-FieldMask'] = fieldMask;
      }

      const url = new URL(endpoint);
      url.searchParams.append('languageCode', languageCode);
      if (sessionToken) {
        url.searchParams.append('sessionToken', sessionToken);
      }

      const response = await this.makeExternalApiCall({
        api_name: 'Google Places Details API',
        endpoint: url.toString(),
        method: 'GET',
        request_payload: {},
        function_name: 'callPlaceDetails',
        customHeaders: headers,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Google Places Details API request failed: ${response.status} ${errorText}`,
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      this.logger.error('GooglePlacesDetailsAPICallError', 'callPlaceDetails', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        placeId,
        languageCode,
        sessionToken,
        fieldMask,
      });
      throw error;
    }
  }

  /**
   * 外部API呼び出しとログ記録を行う
   */
  private async makeExternalApiCall(
    params: Omit<
      CreateExternalApiInput,
      'status_code' | 'response_time_ms' | 'response_payload' | 'error_message'
    > & {
      customHeaders?: Record<string, string>;
      skipLogging?: boolean;
    },
  ): Promise<Response> {
    const {
      api_name,
      endpoint,
      method,
      request_payload,
      function_name,
      customHeaders = {},
      skipLogging = false,
    } = params;
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...customHeaders,
      };

      const response = await fetch(endpoint, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(request_payload) : undefined,
      });

      const responseTime = Date.now() - startTime;

      if (!skipLogging) {
        // 成功時のログ記録
        await this.logger.externalApi({
          api_name,
          endpoint,
          method,
          request_payload,
          response_payload: await response
            .clone()
            .json()
            .catch(() => null),
          status_code: response.status,
          response_time_ms: responseTime,
          function_name,
          error_message: null,
        });
      }

      return response;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (!skipLogging) {
        // エラー時のログ記録
        await this.logger.externalApi({
          api_name,
          endpoint,
          method,
          request_payload: request_payload,
          response_payload: null,
          status_code: 0,
          error_message:
            error instanceof Error ? error.message : 'Unknown error',
          response_time_ms: responseTime,
          function_name,
        });
      }

      throw error;
    }
  }
}
