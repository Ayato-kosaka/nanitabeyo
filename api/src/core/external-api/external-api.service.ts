// api/src/core/external-api/external-api.service.ts
//
// External API service for Wikidata, Google Custom Search, and Claude API
//

import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { CreateExternalApiInput } from '../logger/logger.types';

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
  role: "assistant";
  type: "message";
  content: {
    type: "text";
    text: string;
  }[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Google Places API のレスポンス型
interface GooglePlacesAutocompleteResponse {
  predictions: {
    place_id: string;
    description: string;
    types: string[];
  }[];
  status: string;
}

// Google Places Text Search API のレスポンス型
interface GooglePlacesTextSearchResponse {
  results: {
    place_id: string;
    name: string;
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
    photos?: {
      photo_reference: string;
    }[];
    reviews?: {
      author_name: string;
      rating: number;
      text: string;
      profile_photo_url?: string;
    }[];
  }[];
  status: string;
}

@Injectable()
export class ExternalApiService {
  constructor(private readonly logger: AppLoggerService) { }

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
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API request failed: ${response.status} ${errorText}`);
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
  async searchWikidata(query: string): Promise<{ qid: string; label: string } | null> {
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
        this.logger.debug
        return { qid: result.id, label: result.label };
      }

      this.logger.debug('searchWikidata', 'searchWikidata', {
        message: 'No results found'
      })
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
        throw new Error(`Google Custom Search API request failed: ${response.status}`);
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
      this.logger.error('GoogleCustomSearchAPICallError', 'getCorrectedSpelling', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        query,
      });
      return null;
    }
  }

  /**
   * Google Places Autocomplete API (地名のみ)
   */
  async searchPlacesAutocomplete(query: string): Promise<{ place_id: string; description: string }[]> {
    this.logger.debug('searchPlacesAutocomplete', 'searchPlacesAutocomplete', {
      query,
    });

    const googleApiKey = env.GOOGLE_API_KEY;

    if (!googleApiKey) {
      this.logger.warn('searchPlacesAutocomplete', 'searchPlacesAutocomplete', {
        error_message: 'Google API key is not configured',
      });
      return [];
    }

    const endpoint = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=geocode&key=${googleApiKey}`;

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Google Places Autocomplete API',
        endpoint,
        method: 'GET',
        request_payload: {},
        function_name: 'searchPlacesAutocomplete',
      });

      if (!response.ok) {
        throw new Error(`Google Places Autocomplete API request failed: ${response.status}`);
      }

      const data: GooglePlacesAutocompleteResponse = await response.json();

      if (data.status === 'OK' && data.predictions) {
        const results = data.predictions
          .filter(p => p.types.includes('locality') || p.types.includes('administrative_area_level_1'))
          .map(p => ({
            place_id: p.place_id,
            description: p.description,
          }));

        this.logger.debug('searchPlacesAutocomplete', 'searchPlacesAutocomplete', {
          resultsCount: results.length,
        });
        return results;
      }

      this.logger.debug('searchPlacesAutocomplete', 'searchPlacesAutocomplete', {
        message: 'No results found',
        status: data.status,
      });
      return [];

    } catch (error) {
      this.logger.error('GooglePlacesAutocompleteAPICallError', 'searchPlacesAutocomplete', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        query,
      });
      return [];
    }
  }

  /**
   * Google Places Text Search API
   */
  async searchPlacesText(query: string, location?: string, radius?: number): Promise<any[]> {
    this.logger.debug('searchPlacesText', 'searchPlacesText', {
      query,
      location,
      radius,
    });

    const googleApiKey = env.GOOGLE_API_KEY;

    if (!googleApiKey) {
      this.logger.warn('searchPlacesText', 'searchPlacesText', {
        error_message: 'Google API key is not configured',
      });
      return [];
    }

    let endpoint = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${googleApiKey}`;
    
    if (location && radius) {
      endpoint += `&location=${location}&radius=${radius}`;
    }

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Google Places Text Search API',
        endpoint,
        method: 'GET',
        request_payload: {},
        function_name: 'searchPlacesText',
      });

      if (!response.ok) {
        throw new Error(`Google Places Text Search API request failed: ${response.status}`);
      }

      const data: GooglePlacesTextSearchResponse = await response.json();

      if (data.status === 'OK' && data.results) {
        this.logger.debug('searchPlacesText', 'searchPlacesText', {
          resultsCount: data.results.length,
        });
        return data.results;
      }

      this.logger.debug('searchPlacesText', 'searchPlacesText', {
        message: 'No results found',
        status: data.status,
      });
      return [];

    } catch (error) {
      this.logger.error('GooglePlacesTextSearchAPICallError', 'searchPlacesText', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        query,
        location,
        radius,
      });
      return [];
    }
  }


  /**
   * 外部API呼び出しとログ記録を行う
   */
  private async makeExternalApiCall(params: Omit<CreateExternalApiInput, 'status_code' | 'response_time_ms' | 'response_payload' | 'error_message'>): Promise<Response> {
    const { api_name, endpoint, method, request_payload, function_name } = params;
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // API特有のヘッダーを追加
      if (api_name === 'Claude API') {
        headers['anthropic-version'] = '2023-06-01';
      }

      const response = await fetch(endpoint, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(request_payload) : undefined,
      });

      const responseTime = Date.now() - startTime;

      // 成功時のログ記録
      await this.logger.externalApi({
        api_name,
        endpoint,
        method,
        request_payload,
        response_payload: await response.clone().json().catch(() => null),
        status_code: response.status,
        response_time_ms: responseTime,
        function_name,
        error_message: null,
      });

      return response;

    } catch (error) {
      const responseTime = Date.now() - startTime;

      // エラー時のログ記録
      await this.logger.externalApi({
        api_name,
        endpoint,
        method,
        request_payload: request_payload,
        response_payload: null,
        status_code: 0,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        response_time_ms: responseTime,
        function_name,
      });

      throw error;
    }
  }
}

