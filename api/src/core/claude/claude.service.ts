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
  ) { }

  /**
   * 料理カテゴリ提案を生成する
   */
  async generateDishCategoryRecommendations(params: {
    location: string;
    timeSlot?: string;
    scene?: string;
    mood?: string;
    restrictions?: string[];
    distance?: number;
    budgetMin?: number;
    budgetMax?: number;
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
    "category": "string (dish category name)",
    "topicTitle": "string (attractive topic title)",
    "reason": "string (brief reason why this is recommended)"
  }
]`;

    const systemPrompt = `${variant.prompt_text}\n\n${outputFormatHint}`.trim();

    const variablePromptPart = `Generate dish category recommendations based on:
${`Location: ${params.location}`}
${params.timeSlot ? `Time slot: ${params.timeSlot}` : ''}
${params.scene ? `Scene: ${params.scene}` : ''}
${params.mood ? `Mood: ${params.mood}` : ''}
${params.restrictions ? `Restrictions: ${params.restrictions}` : ''}
${params.distance ? `Distance: ${params.distance}m` : ''}
${params.budgetMin || params.budgetMax ? `Budget: ${params.budgetMin || 0} - ${params.budgetMax || 'unlimited'} yen` : ''}

Generate 10 diverse and appealing dish category recommendations.`;

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
      // ExternalApiServiceを使ってClaude APIを呼び出し
      const response =
        await this.externalApiService.callClaudeAPI(requestPayload);

      if (response.stop_reason && response.stop_reason !== 'end_turn') {
        throw new Error(
          `Claude API failed: Unexpected stop_reason - ${response.stop_reason}`,
        );
      }

      const responseText = response.content[0]?.text || '';

      let parsedJson: DishCategoryTopicResponse[];
      try {
        parsedJson = JSON.parse(responseText) as DishCategoryTopicResponse[];
      } catch (e) {
        throw new Error(
          `Claude API failed: Invalid JSON response - ${(e as Error).message}`,
        );
      }

      if (!Array.isArray(parsedJson) || parsedJson.length !== 10) {
        throw new Error(
          'Claude API failed: Expected array of 10 recommendations',
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
