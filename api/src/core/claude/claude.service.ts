// api/src/core/claude/claude.service.ts
//
// Claude API service for generating dish category recommendations
// Based on: https://github.com/Ayato-kosaka/nanicore-audio-guide/blob/2ed1e376fcc453905db507847e6512ab2f091eae/functions/src/v1/lib/claude.ts
//

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

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
  }): Promise<DishCategoryTopicResponse[]> {
    this.logger.debug('Generating dish category recommendations', params);

    const systemPrompt = `You are a food recommendation AI that suggests dish categories based on user preferences and context.
Generate exactly 10 diverse dish category recommendations based on the provided parameters.

HARD RULES: Use the following JSON format exactly:
[
  {
    "category": "string (dish category name in Japanese)",
    "topicTitle": "string (attractive topic title in Japanese)",
    "reason": "string (brief reason why this is recommended in Japanese)"
  }
]`;

    const userPrompt = `Generate dish category recommendations based on:
${params.location ? `Location: ${params.location}` : ''}
${params.timeSlot ? `Time slot: ${params.timeSlot}` : ''}
${params.scene ? `Scene: ${params.scene}` : ''}
${params.mood ? `Mood: ${params.mood}` : ''}
${params.restrictions ? `Restrictions: ${params.restrictions}` : ''}
${params.distance ? `Distance: ${params.distance}m` : ''}
${params.budgetMin || params.budgetMax ? `Budget: ${params.budgetMin || 0} - ${params.budgetMax || 'unlimited'} yen` : ''}

Generate 10 diverse and appealing dish category recommendations.`;

    const requestPayload = {
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
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