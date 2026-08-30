// api/src/core/external-api/external-api.service.ts
//
// External API service for Wikidata, Google Custom Search, and Claude API
//

import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { CreateExternalApiInput } from '../logger/logger.types';
import { google } from '@googlemaps/places/build/protos/protos';
import {
  PhotoMediaBinary,
  PhotoMediaJson,
} from 'src/v1/locations/locations.service';

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
export interface ClaudeMessageResponse {
  id: string;
  model: string;
  role: 'assistant';
  type: 'message';
  content: (
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'tool_use';
        id: string;
        name: string;
        input: any;
      }
  )[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Claude API のリクエスト型
export interface ClaudeMessageRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: {
    role: 'user' | 'assistant';
    content: string;
  }[];
  tools?: {
    name: string;
    description: string;
    input_schema: any;
  }[];
  tool_choice?:
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'tool'; name: string };
  stream?: boolean;
}

@Injectable()
export class ExternalApiService {
  constructor(private readonly logger: AppLoggerService) {}

  /**
   * Claude API呼び出し
   */
  async callClaudeAPI(
    payload: ClaudeMessageRequest,
  ): Promise<ClaudeMessageResponse> {
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
        request_payload: payload as any, // Allow flexible payload types for Claude API
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

    // #1596 失敗時のログレベルを分けるために、HTTP ステータスを catch まで持ち越す。
    // 403 は「クォータ超過・鍵の権限不足」で、こちらの運用で起こりうる想定内の失敗。
    // それ以外（5xx・ネットワーク断）は Google 側の障害かこちらのバグであり、
    // **error として拾えないと気付けない**。
    let responseStatus: number | null = null;

    try {
      const response = await this.makeExternalApiCall({
        api_name: 'Google Custom Search API',
        endpoint,
        method: 'GET',
        function_name: 'getCorrectedSpelling',
        request_payload: {},
      });
      responseStatus = response.status;

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
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // #1596 403 だけ warn、それ以外は error。
      //
      // ここは **元々 spec がそう書いてあったのに実装が追いついていなかった**箇所。
      // `external-api.service.spec.ts` の «should log 403 errors as warning instead of
      // error» / «should log non-403 errors as error level» は、api の jest が
      // env 起因で suite ごと落ちていたため一度も実行されておらず、
      // 実装は全部 warn のままだった。結果、Google Custom Search の 5xx・ネットワーク断が
      // error レベルに乗らず、error-triage の起票対象から外れていた。
      const logFailure =
        responseStatus === 403
          ? this.logger.warn.bind(this.logger)
          : this.logger.error.bind(this.logger);

      logFailure('GoogleCustomSearchAPICallError', 'getCorrectedSpelling', {
        error_message: errorMessage,
        query,
      });
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
        request_payload: payload,
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
   * Google Places API: Photo Media 取得
   */
  async getPhotoMedia(
    photoRef: string,
    widthPx?: number,
    heightPx?: number,
    opts?: { skipHttpRedirect?: true },
  ): Promise<PhotoMediaJson | null>;
  async getPhotoMedia(
    photoRef: string,
    widthPx: number | undefined,
    heightPx: number | undefined,
    opts: { skipHttpRedirect: false },
  ): Promise<PhotoMediaBinary | null>;
  async getPhotoMedia(
    photoRef: string,
    widthPx?: number,
    heightPx?: number,
    opts?: { skipHttpRedirect?: boolean },
  ): Promise<PhotoMediaJson | PhotoMediaBinary | null>;
  async getPhotoMedia(
    photoRef: string,
    widthPx?: number,
    heightPx?: number,
    opts?: { skipHttpRedirect?: boolean },
  ): Promise<PhotoMediaJson | PhotoMediaBinary | null> {
    const apiKey = env.GOOGLE_PLACE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_PLACE_API_KEY is not configured');
    }

    const { skipHttpRedirect = true } = opts ?? {};
    const photoName = photoRef.endsWith('/media')
      ? photoRef
      : `${photoRef}/media`;

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('skipHttpRedirect', String(skipHttpRedirect));

    // 画像サイズ（幅優先、無指定なら 1280px）
    if (widthPx) {
      queryParams.append('maxWidthPx', widthPx.toString());
    } else if (heightPx) {
      queryParams.append('maxHeightPx', heightPx.toString());
    } else {
      queryParams.append('maxWidthPx', '1280');
    }

    const endpoint = `https://places.googleapis.com/v1/${photoName}?${queryParams.toString()}`;

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

      if (skipHttpRedirect) {
        // skip=true のときは JSON で photoUri が返る
        const data = await response.json().catch(() => null as any);
        if (data?.photoUri) {
          return { photoUri: data.photoUri };
        }
        return null;
      } else {
        // skip=false のときは 302 → 実体画像へリダイレクト
        // fetch はデフォルトでリダイレクト追従するので、この response は画像本体
        const contentType =
          response.headers?.get?.('content-type') ?? 'application/octet-stream';

        // ← arrayBuffer を使い、Node で Buffer に変換
        const ab = await response.arrayBuffer();
        const buffer = Buffer.from(ab);
        return { buffer, contentType, byteLength: buffer.length };
      }
    } catch (error) {
      // #1320 【設計】唯一の呼び出し元 locations.service.ts の tryGetPhotoMedia は
      // 写真候補を順に試すフォールバックを持っており、ここでの失敗は設計上回復可能。
      // 回復しきれなかった最終的な失敗は呼び出し元側（dishes.service.ts の
      // bulk-import の per-place catch）で error として記録されるため、ここを
      // error にすると、フォールバックが成功しているケースまで人間の対応が
      // 必要な事象として自動起票されてしまう。
      this.logger.warn('GooglePlacesPhotosAPICallError', 'getPhotoMedia', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        photoRef,
        widthPx,
        heightPx,
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
        request_payload: payload,
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
   * Google Geocoding API: Reverse Geocoding
   */
  async callReverseGeocoding(
    lat: number,
    lng: number,
    languageCode: string,
  ): Promise<{
    results: {
      address_components?: {
        long_name?: string;
        short_name?: string;
        types?: string[];
      }[];
      formatted_address?: string;
      geometry?: {
        location?: {
          lat?: number;
          lng?: number;
        };
        location_type?: string;
        viewport?: {
          northeast?: {
            lat?: number;
            lng?: number;
          };
          southwest?: {
            lat?: number;
            lng?: number;
          };
        };
      };
      place_id?: string;
      plus_code?: {
        compound_code?: string;
        global_code?: string;
      };
      types?: string[];
    }[];
    status: string;
  }> {
    const apiKey = env.GOOGLE_PLACE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_PLACE_API_KEY is not configured');
    }

    const endpoint = 'https://maps.googleapis.com/maps/api/geocode/json';

    try {
      const url = new URL(endpoint);
      url.searchParams.append('latlng', `${lat},${lng}`);
      url.searchParams.append('key', apiKey);
      url.searchParams.append('language', languageCode);
      url.searchParams.append(
        'result_type',
        'street_address|locality|administrative_area_level_1|country',
      );

      const response = await this.makeExternalApiCall({
        api_name: 'Google Geocoding API',
        endpoint: url.toString(),
        method: 'GET',
        request_payload: {},
        function_name: 'callReverseGeocoding',
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Google Geocoding API request failed: ${response.status} ${errorText}`,
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      this.logger.error('GoogleGeocodingAPICallError', 'callReverseGeocoding', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        lat,
        lng,
        languageCode,
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
