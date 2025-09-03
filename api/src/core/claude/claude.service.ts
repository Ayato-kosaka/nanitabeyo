// api/src/core/claude/claude.service.ts
//
// Claude API service for generating dish category recommendations
// Based on: https://github.com/Ayato-kosaka/nanicore-audio-guide/blob/develop/functions/src/v1/lib/claude.ts
//

import { Injectable } from '@nestjs/common';
import { PromptService } from '../prompt/prompt.service';
import {
  ExternalApiService,
  ClaudeMessageRequest,
} from '../external-api/external-api.service';
import { CLS_KEY_REQUEST_ID, CLS_KEY_USER_ID } from '../cls/cls.constants';
import { ClsService } from 'nestjs-cls';
import { AppLoggerService } from '../logger/logger.service';
import {
  DISH_CATEGORY_TOOL_SCHEMA,
  extractDishCategoryItems,
  DishCategoryItem,
} from './tool-schema';
import {
  withTwoLayerRetry,
  DEFAULT_RETRY_OPTIONS,
  LOGICAL_RETRY_OPTIONS,
} from './retry-utils';

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
   * Uses Claude tool calling for structured output instead of free-form JSON parsing
   */
  async generateDishCategoryRecommendations(params: {
    address: string;
    timeSlot?: string;
    scene?: string;
    mood?: string;
    restrictions?: string[];
    languageTag: string;
  }): Promise<DishCategoryItem[]> {
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

    // Enhanced system prompt for tool calling
    const systemPrompt = `${variant.prompt_text}

CRITICAL INSTRUCTIONS:
- You MUST use the provided tool to generate exactly 10 dish category recommendations
- Each category MUST match Wikidata labels exactly 
- All text content MUST be in ${params.languageTag}
- Do NOT output any free-form text - use ONLY the tool
- Avoid ASCII double quotes (") in text values; use Japanese quotes (「」) or single quotes when needed
- Each recommendation must have unique, appealing content`.trim();

    const variablePromptPart = `Generate ${EXPECTED_RECOMMENDATIONS_COUNT} diverse and appealing dish category recommendations based on:  
${`Address: ${params.address}`}
${params.timeSlot ? `Time slot: ${params.timeSlot}` : ''}
${params.scene ? `Scene: ${params.scene}` : ''}
${params.mood ? `Mood: ${params.mood}` : ''}
${params.restrictions ? `Restrictions: ${params.restrictions}` : ''}`;

    const fullPrompt = `${systemPrompt}\n\n${variablePromptPart}`;

    // Claude API request with tool calling
    const requestPayload: ClaudeMessageRequest = {
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
      tools: [DISH_CATEGORY_TOOL_SCHEMA],
      tool_choice: {
        type: 'tool',
        name: DISH_CATEGORY_TOOL_SCHEMA.name,
      },
      stream: false, // Non-streaming by default as requested
    };

    try {
      // Store response data for usage tracking
      let lastResponse: any;
      let lastResponseContent: any;

      // Two-layer retry: API retries + logical validation retries
      const retryResult = await withTwoLayerRetry(
        // Layer 1: API call with transport-level retries
        async () => {
          const response =
            await this.externalApiService.callClaudeAPI(requestPayload);
          lastResponse = response;
          return response;
        },
        // Layer 2: Logical validation with schema checking
        (response) => {
          if (
            response.stop_reason &&
            !['end_turn', 'tool_use'].includes(response.stop_reason)
          ) {
            throw new Error(
              `Claude API failed: Unexpected stop_reason - ${response.stop_reason}`,
            );
          }

          // Find tool_use content in response
          const toolUseContent = response.content.find(
            (content) => content.type === 'tool_use',
          );

          if (!toolUseContent) {
            throw new Error(
              'Expected tool_use content not found in Claude response',
            );
          }

          lastResponseContent = toolUseContent;

          // Extract and validate tool response
          const items = extractDishCategoryItems(toolUseContent);
          if (!items) {
            throw new Error(
              'Tool response validation failed: Invalid structure or item count',
            );
          }

          if (items.length !== EXPECTED_RECOMMENDATIONS_COUNT) {
            throw new Error(
              `Invalid item count: expected ${EXPECTED_RECOMMENDATIONS_COUNT}, got ${items.length}`,
            );
          }

          return response; // Return the original response to satisfy type requirements
        },
        // API retry options
        {
          maxRetries: 2, // Reduced retries to avoid long delays
          baseDelayMs: 500,
          maxDelayMs: 5000,
        },
        // Logical retry options (single retry for schema validation failures)
        LOGICAL_RETRY_OPTIONS,
      );

      // Extract items from the final validated response
      const toolUseContent = retryResult.result.content.find(
        (content) => content.type === 'tool_use',
      );
      const extractedItems = extractDishCategoryItems(toolUseContent!)!;
      lastResponseContent = toolUseContent;

      // Log successful tool calling with separated content and metadata
      this.logger.debug(
        'ClaudeToolResponseSuccess',
        'generateDishCategoryRecommendations',
        {
          toolName: DISH_CATEGORY_TOOL_SCHEMA.name,
          itemCount: extractedItems.length,
          retryMetrics: retryResult.metrics,
          responseId: lastResponse.id,
          model: lastResponse.model,
        },
      );

      // Log tool response content separately from metadata
      this.logger.debug(
        'ClaudeToolContent',
        'generateDishCategoryRecommendations',
        {
          toolInput: lastResponseContent.input,
          toolId: lastResponseContent.id,
          toolName: lastResponseContent.name,
        },
      );

      // PromptServiceを使ってプロンプト使用履歴を記録
      await this.promptService.createPromptUsage({
        family_id: family.id,
        variant_id: variant.id,
        target_type: 'dish_category_recommendations',
        target_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
        generated_text: JSON.stringify(extractedItems), // Store structured data instead of raw text
        used_prompt_text: fullPrompt,
        input_data: params,
        llm_model: 'claude-3-haiku-20240307',
        temperature: 0.7,
        generated_user: this.cls.get<string>(CLS_KEY_USER_ID),
        metadata: {
          response_length: extractedItems.length,
          input_tokens: lastResponse.usage.input_tokens,
          output_tokens: lastResponse.usage.output_tokens,
          tool_calling: true,
          retry_metrics: retryResult.metrics,
        },
      });

      this.logger.debug(
        'DishCategoryRecommendationsGenerated',
        'generateDishCategoryRecommendations',
        {
          count: extractedItems.length,
          retryMetrics: retryResult.metrics,
        },
      );

      // Return in the expected format (maintain backward compatibility)
      return extractedItems as DishCategoryItem[];
    } catch (error) {
      this.logger.error(
        'GenerateDishCategoryRecommendationsError',
        'generateDishCategoryRecommendations',
        {
          error_message: error instanceof Error ? error.message : String(error),
          tool_calling_enabled: true,
        },
      );
      throw error;
    }
  }
}
