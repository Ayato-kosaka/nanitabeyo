// api/src/core/utils/static-master.service.ts
//
// Static Master service for retrieving prompt families and variants
//

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StaticMasterService {
  private readonly logger = new Logger(StaticMasterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * プロンプトファミリーを取得
   */
  async getStaticMaster(tableName: 'prompt_families'): Promise<any[]>;
  async getStaticMaster(tableName: 'prompt_variants'): Promise<any[]>;
  async getStaticMaster(tableName: string): Promise<any[]> {
    this.logger.debug(`Getting static master: ${tableName}`);

    switch (tableName) {
      case 'prompt_families':
        return this.prisma.prompt_families.findMany();
      case 'prompt_variants':
        return this.prisma.prompt_variants.findMany();
      default:
        throw new Error(`Unsupported static master table: ${tableName}`);
    }
  }

  /**
   * プロンプト使用履歴を記録
   */
  async createPromptUsage(data: {
    family_id: string;
    variant_id: string;
    target_type: string;
    target_id: string;
    generated_text: string;
    used_prompt_text: string;
    input_data?: any;
    llm_model: string;
    temperature?: number;
    generated_user: string;
    created_request_id: string;
    metadata?: any;
  }) {
    this.logger.debug('Creating prompt usage record');

    return this.prisma.prompt_usages.create({
      data: {
        id: `prompt_usage_${Date.now()}_${Math.random().toString(36).substring(2)}`,
        family_id: data.family_id,
        variant_id: data.variant_id,
        target_type: data.target_type,
        target_id: data.target_id,
        generated_text: data.generated_text,
        used_prompt_text: data.used_prompt_text,
        input_data: data.input_data,
        llm_model: data.llm_model,
        temperature: data.temperature,
        generated_user: data.generated_user,
        created_at: new Date(),
        created_request_id: data.created_request_id,
        metadata: data.metadata,
      },
    });
  }
}