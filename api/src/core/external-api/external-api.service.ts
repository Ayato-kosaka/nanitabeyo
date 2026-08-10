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
import {
  ExternalApiQuotaExceededError,
  isQuotaExceededUpstreamResponse,
} from './external-api.errors';

/** #1196 クォータ枯渇ログのグルーピングキー。makeExternalApiCall の api_name と同一文字列にする。 */
const PLACES_TEXT_SEARCH_API_NAME = 'Google Places Text Search API';

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
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        'GoogleCustomSearchAPICallError',
        'getCorrectedSpelling',
        {
          error_message: errorMessage,
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
        api_name: PLACES_TEXT_SEARCH_API_NAME,
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
        const message = `Google Places Text Search API request failed: ${response.status} ${errorText}`;

        // #1196 【設計】クォータ枯渇だけは型付きのエラーで投げ、上位が
        // 「予期しない障害」と「上流の容量が尽きた」を message の文字列一致なしで分けられるようにする。
        if (isQuotaExceededUpstreamResponse(response.status, errorText)) {
          throw new ExternalApiQuotaExceededError({
            apiName: PLACES_TEXT_SEARCH_API_NAME,
            upstreamStatus: response.status,
            message,
          });
        }

        throw new Error(message);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      // #1196 【設計】ログレベルを2軸に分ける。
      //   (1) システム異常 = クォータ枯渇。**error のまま残す**。
      //       ユーザーは Google Maps フォールバックへ逃げられる（後述）が、
      //       「1日で Text Search の日次上限が尽きている」こと自体は運用が直すべき異常であり、
      //       ここを warn に落とすと error-triage（scripts/error-triage）が拾わなくなって
      //       誰も気づけなくなる。専用の event_name を持たせて独立した fingerprint にする。
      //       payload に statusCode を入れないこと: 入れると triage の E6 が
      //       EXCLUDED_HTTP_STATUSES(429 を含む) として除外してしまう。
      //   (2) ユーザー影響 = この失敗で検索結果が出ないこと。こちらは呼び出し側
      //       (locations.service / dishes.service) が warn で記録する。
      //       ★ 退避導線（Google Maps フォールバック）の実態（#1243 レビュー Major-1 で grep 済み。
      //         2026-08-10 時点。**「唯一の入口」でも「必ず出る」でもない**ので、
      //         この節を根拠に他の経路まで warn へ広げないこと）:
      //         この Places 呼び出しに到達する API は POST /v1/dishes/bulk-import で、
      //         app-expo 側の入口は lib/dishMediaSearch.ts createDishItemsForCategory の呼び出し元 3 つ。
      //           1. features/dishCategoryGroupVotes/hooks/useCandidateDishMediaCache.ts
      //              … catch で showGoogleMapsFallbackDialog。退避導線あり
      //           2. app/[locale]/(tabs)/search/topics.tsx → app/[locale]/(tabs)/search/result.tsx
      //              … 「0 件かつ非ロード中」で表示。退避導線あり
      //           3. features/profile/tabs/SavedTopicsTab.tsx
      //              → app/[locale]/(tabs)/profile/search-results.tsx
      //              … **#1243 で追加**。それ以前はこの経路だけ退避導線が無く、行き止まりだった
      //         2 と 3 は緯度経度とカテゴリ名が router の params に揃っているときだけ出る（無条件ではない）。
      //         実測（#1196 / BigQuery）では 340 件の失敗に対しダイアログ 340 件・
      //         実際に Maps を開いたのが 115 人だが、これは 3 を追加する前の 1 と 2 だけの数字。
      if (error instanceof ExternalApiQuotaExceededError) {
        this.logger.error('GooglePlacesQuotaExceeded', 'callPlaceSearchText', {
          error_message: error.message,
          api_name: error.apiName,
          upstream_status: error.upstreamStatus,
          fieldMask,
          request_payload: payload,
        });
        throw error;
      }

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
      this.logger.error('GooglePlacesPhotosAPICallError', 'getPhotoMedia', {
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
