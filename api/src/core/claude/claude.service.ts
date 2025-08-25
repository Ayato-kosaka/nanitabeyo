// api/src/core/claude/claude.service.ts
//
// Claude API service for generating dish category recommendations
// Based on: https://github.com/Ayato-kosaka/nanicore-audio-guide/blob/develop/functions/src/v1/lib/claude.ts
//

import { Injectable } from '@nestjs/common';
import { PromptService } from '../prompt/prompt.service';
import { ExternalApiService } from '../external-api/external-api.service';
import { CLS_KEY_REQUEST_ID, CLS_KEY_USER_ID } from '../cls/cls.constants';
import { ClsService } from 'nestjs-cls';
import { AppLoggerService } from '../logger/logger.service';
import {
  sanitizeAndParseJson,
  isValidDishCategoryArray,
} from './json-sanitizer';
import { withRetry, DEFAULT_RETRY_OPTIONS } from './retry-utils';

// トピック生成レスポンス型
export interface DishCategoryTopicResponse {
  category: string;
  topicTitle: string;
  reason: string;
}

// 期待する料理カテゴリ推奨の数
const EXPECTED_RECOMMENDATIONS_COUNT = 10;

@Injectable()
export class ClaudeService {
  constructor(
    private readonly promptService: PromptService,
    private readonly externalApiService: ExternalApiService,
    private readonly cls: ClsService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 料理カテゴリ提案を生成する
   */
  async generateDishCategoryRecommendations(params: {
    address: string;
    timeSlot?: string;
    scene?: string;
    mood?: string;
    restrictions?: string[];
    languageTag: string;
  }): Promise<DishCategoryTopicResponse[]> {
    this.logger.debug(
      'GenerateDishCategoryRecommendations',
      'generateDishCategoryRecommendations',
      params,
    );

    // PromptServiceからプロンプトを取得
    const prompt = await this.promptService.getPromptForPurpose(
      'dish_category_recommendations',
    );
    if (!prompt) {
      throw new Error(
        'No eligible prompt found for dish_category_recommendations.',
      );
    }

    const { family, variant } = prompt;

    const outputFormatHint = `HARD RULES: Output MUST be valid JSON. Do not include any explanation or text outside of the JSON array.
HARD RULES: Use the following JSON format exactly:
[
  {
    "category": "string (dish category name, MUST match Wikidata label exactly)",
    "topicTitle": "string (catchy topic title)",
    "reason": "string (brief reason why this is recommended)"
  }
]
HARD RULES: All text content (category, topicTitle, reason) MUST be in the language specified by the language tag: ${params.languageTag}`;

    const systemPrompt = `${variant.prompt_text}\n\n${outputFormatHint}`.trim();

    const variablePromptPart = `Generate ${EXPECTED_RECOMMENDATIONS_COUNT} diverse and appealing dish category recommendations based on:  
${`Address: ${params.address}`}
${params.timeSlot ? `Time slot: ${params.timeSlot}` : ''}
${params.scene ? `Scene: ${params.scene}` : ''}
${params.mood ? `Mood: ${params.mood}` : ''}
${params.restrictions ? `Restrictions: ${params.restrictions}` : ''}`;

    const fullPrompt = `${systemPrompt}\n\n${variablePromptPart}`;

    const requestPayload = {
      model: 'claude-3-haiku-20240307',
      max_tokens: 4096,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: variablePromptPart,
        },
      ],
    };

    try {
      // Store response data for usage tracking
      let lastResponse: any;
      let lastResponseText = '';

      // Retry logic for both API call and JSON parsing
      const parsedJson = await withRetry(
        async (): Promise<DishCategoryTopicResponse[]> => {
          // ExternalApiServiceを使ってClaude APIを呼び出し
          const response =
            await this.externalApiService.callClaudeAPI(requestPayload);
          
          // Store for usage tracking
          lastResponse = response;
          lastResponseText = response.content[0]?.text || '';

          if (response.stop_reason && response.stop_reason !== 'end_turn') {
            throw new Error(
              `Claude API failed: Unexpected stop_reason - ${response.stop_reason}`,
            );
          }

          // Log raw response for debugging JSON parsing issues
          this.logger.debug(
            'ClaudeRawResponse',
            'generateDishCategoryRecommendations',
            {
              responseLength: lastResponseText.length,
              responsePreview: lastResponseText.substring(0, 200),
            },
          );

          // Try sanitized JSON parsing first
          const sanitizedResult =
            sanitizeAndParseJson<DishCategoryTopicResponse[]>(lastResponseText);

          if (sanitizedResult && isValidDishCategoryArray(sanitizedResult)) {
            this.logger.debug(
              'JSONParsedSuccessfully',
              'generateDishCategoryRecommendations',
              {
                method: 'sanitized',
                count: sanitizedResult.length,
              },
            );
            return sanitizedResult;
          }

          // Fallback: try direct JSON.parse
          try {
            const directResult = JSON.parse(lastResponseText) as DishCategoryTopicResponse[];
            this.logger.debug(
              'JSONParsedSuccessfully',
              'generateDishCategoryRecommendations',
              {
                method: 'direct',
                count: directResult.length,
              },
            );
            return directResult;
          } catch (parseError) {
            // Enhanced error logging with response content for debugging
            this.logger.error(
              'JSONParseFailure',
              'generateDishCategoryRecommendations',
              {
                parseError:
                  parseError instanceof Error
                    ? parseError.message
                    : String(parseError),
                responseText: lastResponseText.substring(0, 500), // Log first 500 chars for debugging
                responseLength: lastResponseText.length,
              },
            );

            throw new Error(
              `Claude API failed: Invalid JSON response - ${(parseError as Error).message}. Response preview: ${lastResponseText.substring(0, 200)}`,
            );
          }
        },
        {
          maxRetries: 2, // Reduced retries to avoid long delays
          baseDelayMs: 500,
          maxDelayMs: 5000,
        },
      );

      // Validate response structure and length
      if (!Array.isArray(parsedJson)) {
        throw new Error('Claude API failed: Response is not an array');
      }

      if (parsedJson.length === 0) {
        throw new Error('Claude API failed: Empty response array');
      }

      // Log warning if not exactly the expected count but continue (graceful degradation)
      if (parsedJson.length !== EXPECTED_RECOMMENDATIONS_COUNT) {
        this.logger.warn(
          'UnexpectedResponseCount',
          'generateDishCategoryRecommendations',
          {
            expected: EXPECTED_RECOMMENDATIONS_COUNT,
            actual: parsedJson.length,
          },
        );
      }

      // PromptServiceを使ってプロンプト使用履歴を記録
      await this.promptService.createPromptUsage({
        family_id: family.id,
        variant_id: variant.id,
        target_type: 'dish_category_recommendations',
        target_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
        generated_text: lastResponseText,
        used_prompt_text: fullPrompt,
        input_data: params,
        llm_model: 'claude-3-haiku-20240307',
        temperature: 0.7,
        generated_user: this.cls.get<string>(CLS_KEY_USER_ID),
        metadata: {
          response_length: parsedJson.length,
          input_tokens: lastResponse.usage.input_tokens,
          output_tokens: lastResponse.usage.output_tokens,
        },
      });

      this.logger.debug(
        'DishCategoryRecommendationsGenerated',
        'generateDishCategoryRecommendations',
        {
          count: parsedJson.length,
        },
      );
      return parsedJson;
    } catch (error) {
      this.logger.error(
        'GenerateDishCategoryRecommendationsError',
        'generateDishCategoryRecommendations',
        {
          error_message: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
  }
}
