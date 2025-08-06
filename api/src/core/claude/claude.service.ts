// api/src/core/claude/claude.service.ts
//
// Claude API service for generating dish category recommendations
// Based on: https://github.com/Ayato-kosaka/nanicore-audio-guide/blob/develop/functions/src/v1/lib/claude.ts
//

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { StaticMasterService } from '../utils/static-master.service';
import { pickByWeight } from '../utils/backend-utils';

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

// トピック生成レスポンス型
export interface DishCategoryTopicResponse {
  category: string;
  topicTitle: string;
  reason: string;
}

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);

  constructor(private readonly staticMasterService: StaticMasterService) {}

  /**
   * 料理カテゴリ提案を生成する
   */
  async generateDishCategoryRecommendations(params: {
    location?: string;
    timeSlot?: string;
    scene?: string;
    mood?: string;
    restrictions?: string;
    distance?: number;
    budgetMin?: number;
    budgetMax?: number;
    requestId: string;
    userId: string;
  }): Promise<DishCategoryTopicResponse[]> {
    this.logger.debug('Generating dish category recommendations', params);

    // Static Masterからプロンプトファミリー・バリアントを読み込み
    const promptFamilies = await this.staticMasterService.getStaticMaster('prompt_families');
    const selectedFamily = pickByWeight(
      promptFamilies.filter((x) => x.purpose === 'dish_category_recommendations').filter((x) => x.weight > 0),
    );
    if (!selectedFamily) {
      throw new Error('No eligible prompt families found for dish_category_recommendations.');
    }

    const promptVariants = await this.staticMasterService.getStaticMaster('prompt_variants');
    const selectedVariant = promptVariants
      .filter((x) => x.family_id === selectedFamily.id)
      .sort((a, b) => b.variant_number - a.variant_number)[0];
    if (!selectedVariant) {
      throw new Error('No eligible prompt variants found.');
    }

    const outputFormatHint = `HARD RULES: Use the following JSON format exactly:
[
  {
    "category": "string (dish category name in Japanese)",
    "topicTitle": "string (attractive topic title in Japanese)",
    "reason": "string (brief reason why this is recommended in Japanese)"
  }
]`;

    const systemPrompt = `${selectedVariant.prompt_text}\n\n${outputFormatHint}`.trim();

    const variablePromptPart = `Generate dish category recommendations based on:
${params.location ? `Location: ${params.location}` : ''}
${params.timeSlot ? `Time slot: ${params.timeSlot}` : ''}
${params.scene ? `Scene: ${params.scene}` : ''}
${params.mood ? `Mood: ${params.mood}` : ''}
${params.restrictions ? `Restrictions: ${params.restrictions}` : ''}
${params.distance ? `Distance: ${params.distance}m` : ''}
${params.budgetMin || params.budgetMax ? `Budget: ${params.budgetMin || 0} - ${params.budgetMax || 'unlimited'} yen` : ''}

Generate 10 diverse and appealing dish category recommendations.`;

    const fullPrompt = `${systemPrompt}\n\n${variablePromptPart}`;

    const requestPayload = {
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: variablePromptPart,
        },
      ],
    };

    try {
      const response = await this.callClaudeAPI(requestPayload);
      
      if (response.stop_reason && response.stop_reason !== "end_turn") {
        throw new Error(`Claude API failed: Unexpected stop_reason - ${response.stop_reason}`);
      }

      const responseText = response.content[0]?.text || "";
      
      let parsedJson: DishCategoryTopicResponse[];
      try {
        parsedJson = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Claude API failed: Invalid JSON response - ${(e as Error).message}`);
      }

      if (!Array.isArray(parsedJson) || parsedJson.length !== 10) {
        throw new Error('Claude API failed: Expected array of 10 recommendations');
      }

      // プロンプト使用履歴を記録
      await this.staticMasterService.createPromptUsage({
        family_id: selectedFamily.id,
        variant_id: selectedVariant.id,
        target_type: 'dish_category_recommendations',
        target_id: params.requestId,
        generated_text: responseText,
        used_prompt_text: fullPrompt,
        input_data: params,
        llm_model: 'claude-3-haiku-20240307',
        temperature: 0.7,
        generated_user: params.userId,
        created_request_id: params.requestId,
        metadata: {
          response_length: parsedJson.length,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      });

      this.logger.debug(`Generated ${parsedJson.length} dish category recommendations`);
      return parsedJson;

    } catch (error) {
      this.logger.error('Failed to generate dish category recommendations', error);
      throw error;
    }
  }

  private async callClaudeAPI(payload: any): Promise<ClaudeMessageResponse> {
    const claudeApiKey = env.CLAUDE_API_KEY;
    
    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY is not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': claudeApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API request failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }
}