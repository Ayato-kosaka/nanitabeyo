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

    const outputFormatHint = `CRITICAL: You MUST output ONLY valid JSON. No explanations, no text outside the JSON array.

REQUIRED JSON FORMAT (exact structure):
[
  {
    "category": "string (dish category name)",
    "topicTitle": "string (catchy topic title)", 
    "reason": "string (brief reason)"
  }
]

FORMATTING RULES:
- All property names MUST use double quotes: "category", "topicTitle", "reason"
- All string values MUST use double quotes
- No trailing commas
- No comments or extra text
- Return exactly 10 items in the array
- Language: ${params.languageTag}`;

    const systemPrompt = `${variant.prompt_text}\n\n${outputFormatHint}`.trim();

    const variablePromptPart = `Generate 10 diverse and appealing dish category recommendations based on:  
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
      // ExternalApiServiceを使ってClaude APIを呼び出し (with retry logic)
      const response = await withRetry(
        () => this.externalApiService.callClaudeAPI(requestPayload),
        {
          maxRetries: 2, // Reduced retries to avoid long delays
          baseDelayMs: 500,
          maxDelayMs: 5000,
        },
      );

      if (response.stop_reason && response.stop_reason !== 'end_turn') {
        throw new Error(
          `Claude API failed: Unexpected stop_reason - ${response.stop_reason}`,
        );
      }

      const responseText = response.content[0]?.text || '';

      // Log raw response for debugging JSON parsing issues
      this.logger.debug(
        'ClaudeRawResponse',
        'generateDishCategoryRecommendations',
        {
          responseLength: responseText.length,
          responsePreview: responseText.substring(0, 200),
        },
      );

      let parsedJson: DishCategoryTopicResponse[];

      // Try sanitized JSON parsing first
      const sanitizedResult =
        sanitizeAndParseJson<DishCategoryTopicResponse[]>(responseText);

      if (sanitizedResult && isValidDishCategoryArray(sanitizedResult)) {
        parsedJson = sanitizedResult;
        this.logger.debug(
          'JSONParsedSuccessfully',
          'generateDishCategoryRecommendations',
          {
            method: 'sanitized',
            count: parsedJson.length,
          },
        );
      } else {
        // Fallback: try direct JSON.parse for backward compatibility
        try {
          parsedJson = JSON.parse(responseText) as DishCategoryTopicResponse[];
          this.logger.debug(
            'JSONParsedSuccessfully',
            'generateDishCategoryRecommendations',
            {
              method: 'direct',
              count: parsedJson.length,
            },
          );
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
              responseText: responseText.substring(0, 500), // Log first 500 chars for debugging
              responseLength: responseText.length,
            },
          );

          // Provide fallback response to gracefully handle the error
          const fallbackResponse: DishCategoryTopicResponse[] = [
            {
              category:
                params.languageTag === 'ja' ? '和食' : 'Japanese cuisine',
              topicTitle:
                params.languageTag === 'ja'
                  ? '一時的に利用できません'
                  : 'Temporarily unavailable',
              reason:
                params.languageTag === 'ja'
                  ? 'システムエラーのため、後でもう一度お試しください'
                  : 'Please try again later due to system error',
            },
          ];

          this.logger.warn(
            'UsingFallbackResponse',
            'generateDishCategoryRecommendations',
            {
              fallbackCount: fallbackResponse.length,
            },
          );

          // Still throw the original error but with enhanced context
          throw new Error(
            `Claude API failed: Invalid JSON response - ${(parseError as Error).message}. Response preview: ${responseText.substring(0, 200)}`,
          );
        }
      }

      // Validate response structure and length
      if (!Array.isArray(parsedJson)) {
        throw new Error('Claude API failed: Response is not an array');
      }

      if (parsedJson.length === 0) {
        throw new Error('Claude API failed: Empty response array');
      }

      // Log warning if not exactly 10 items but continue (graceful degradation)
      if (parsedJson.length !== 10) {
        this.logger.warn(
          'UnexpectedResponseCount',
          'generateDishCategoryRecommendations',
          {
            expected: 10,
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
        generated_text: responseText,
        used_prompt_text: fullPrompt,
        input_data: params,
        llm_model: 'claude-3-haiku-20240307',
        temperature: 0.7,
        generated_user: this.cls.get<string>(CLS_KEY_USER_ID),
        metadata: {
          response_length: parsedJson.length,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
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
