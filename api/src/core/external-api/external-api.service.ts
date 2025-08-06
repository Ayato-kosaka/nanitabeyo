// api/src/core/external-api/external-api.service.ts
//
// External API service for Wikidata, Google Custom Search, and Claude API
//

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { PrismaService } from '../../prisma/prisma.service';

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

interface ExternalApiCallParams {
  apiName: string;
  endpoint: string;
  method: string;
  requestPayload?: any;
  requestId?: string;
  userId?: string;
  functionName?: string;
}

@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claude API呼び出し
   */
  async callClaudeAPI(payload: any, requestId?: string, userId?: string): Promise<ClaudeMessageResponse> {
    const claudeApiKey = env.CLAUDE_API_KEY;
    
    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY is not configured');
    }

    const endpoint = 'https://api.anthropic.com/v1/messages';
    const startTime = Date.now();

    try {
      const response = await this.makeExternalApiCall({
        apiName: 'Claude API',
        endpoint,
        method: 'POST',
        requestPayload: payload,
        requestId,
        userId,
        functionName: 'callClaudeAPI',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API request failed: ${response.status} ${errorText}`);
      }

      const responseData = await response.json();
      return responseData;

    } catch (error) {
      this.logger.error('Claude API call failed', error);
      throw error;
    }
  }

  /**
   * Wikidata で料理カテゴリを検索
   */
  async searchWikidata(query: string, requestId?: string, userId?: string): Promise<{ qid: string; label: string } | null> {
    this.logger.debug(`Searching Wikidata for: ${query}`);

    const endpoint = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=ja&type=item&limit=1&search=${encodeURIComponent(query)}`;

    try {
      const response = await this.makeExternalApiCall({
        apiName: 'Wikidata API',
        endpoint,
        method: 'GET',
        requestId,
        userId,
        functionName: 'searchWikidata',
      });

      if (!response.ok) {
        throw new Error(`Wikidata API request failed: ${response.status}`);
      }

      const data: WikidataSearchResponse = await response.json();
      
      if (data.search && data.search.length > 0) {
        const result = data.search[0];
        this.logger.debug(`Found Wikidata result: ${result.label}`);
        return { qid: result.id, label: result.label };
      }

      this.logger.debug('No Wikidata results found');
      return null;

    } catch (error) {
      this.logger.error('Failed to search Wikidata', error);
      return null;
    }
  }

  /**
   * Google Custom Search で料理カテゴリのスペルチェック
   */
  async getCorrectedSpelling(query: string, requestId?: string, userId?: string): Promise<string | null> {
    this.logger.debug(`Getting corrected spelling for: ${query}`);

    const googleApiKey = env.GOOGLE_API_KEY;
    const searchEngineId = env.GOOGLE_SEARCH_ENGINE_ID;

    if (!googleApiKey || !searchEngineId) {
      this.logger.warn('Google Custom Search API not configured');
      return null;
    }

    const endpoint = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;

    try {
      const response = await this.makeExternalApiCall({
        apiName: 'Google Custom Search API',
        endpoint,
        method: 'GET',
        requestId,
        userId,
        functionName: 'getCorrectedSpelling',
      });

      if (!response.ok) {
        throw new Error(`Google Custom Search API request failed: ${response.status}`);
      }

      const data: GoogleCustomSearchResponse = await response.json();
      
      if (data.spelling?.correctedQuery) {
        this.logger.debug(`Found corrected spelling: ${data.spelling.correctedQuery}`);
        return data.spelling.correctedQuery;
      }

      this.logger.debug('No spelling correction found');
      return null;

    } catch (error) {
      this.logger.error('Failed to get corrected spelling', error);
      return null;
    }
  }

  /**
   * 外部API呼び出しとログ記録を行う
   */
  private async makeExternalApiCall(params: ExternalApiCallParams): Promise<Response> {
    const { apiName, endpoint, method, requestPayload, requestId, userId, functionName } = params;
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // API特有のヘッダーを追加
      if (apiName === 'Claude API') {
        headers['anthropic-version'] = '2023-06-01';
        headers['x-api-key'] = env.CLAUDE_API_KEY || '';
      }

      const response = await fetch(endpoint, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(requestPayload) : undefined,
      });

      const responseTime = Date.now() - startTime;
      
      // 成功時のログ記録
      await this.logExternalApiCall({
        apiName,
        endpoint,
        method,
        requestPayload,
        responsePayload: await response.clone().json().catch(() => null),
        statusCode: response.status,
        responseTimeMs: responseTime,
        requestId,
        userId,
        functionName,
      });

      return response;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // エラー時のログ記録
      await this.logExternalApiCall({
        apiName,
        endpoint,
        method,
        requestPayload,
        statusCode: 0,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        responseTimeMs: responseTime,
        requestId,
        userId,
        functionName,
      });

      throw error;
    }
  }

  /**
   * 外部API呼び出しログを記録
   */
  private async logExternalApiCall(params: {
    apiName: string;
    endpoint: string;
    method: string;
    requestPayload?: any;
    responsePayload?: any;
    statusCode: number;
    errorMessage?: string;
    responseTimeMs: number;
    requestId?: string;
    userId?: string;
    functionName?: string;
  }): Promise<void> {
    try {
      await this.prisma.external_api_logs.create({
        data: {
          id: crypto.randomUUID(),
          request_id: params.requestId,
          function_name: params.functionName,
          api_name: params.apiName,
          endpoint: params.endpoint,
          method: params.method,
          request_payload: params.requestPayload,
          response_payload: params.responsePayload,
          status_code: params.statusCode,
          error_message: params.errorMessage,
          response_time_ms: params.responseTimeMs,
          user_id: params.userId,
          created_at: new Date(),
          created_commit_id: env.COMMIT_ID || 'unknown',
        },
      });

      this.logger.debug(`External API log recorded: ${params.apiName} ${params.statusCode}`);

    } catch (error) {
      this.logger.error('Failed to log external API call', error);
      // Don't throw here - logging failure shouldn't break the main flow
    }
  }
}