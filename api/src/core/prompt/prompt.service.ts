// api/src/core/prompt/prompt.service.ts
//
// Prompt service for managing prompt families, variants, and usage logging
//

import { Injectable, Logger } from '@nestjs/common';
import { StaticMasterService } from '../utils/static-master.service';
import { pickByWeight } from '../utils/weight.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../../shared/prisma';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class PromptService {
  private readonly logger = new Logger(PromptService.name);

  constructor(
    private readonly staticMasterService: StaticMasterService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) { }

  /**
   * プロンプトファミリーとバリアントを取得し、重み付け選択を行う
   */
  async getPromptForPurpose(purpose: string) {
    this.logger.debug(`Getting prompt for purpose: ${purpose}`);

    try {
      // Static Masterからプロンプトファミリーを取得
      const promptFamilies = await this.staticMasterService.getStaticMaster('prompt_families');
      const eligibleFamilies = promptFamilies
        .filter((x) => x.purpose === purpose)
        .filter((x) => x.weight > 0);

      if (eligibleFamilies.length === 0) {
        this.logger.warn(`No eligible prompt families found for purpose: ${purpose}`);
        return null;
      }

      // 重み付け選択でファミリーを選択
      const selectedFamily = pickByWeight(eligibleFamilies);
      if (!selectedFamily) {
        this.logger.warn(`Failed to select prompt family for purpose: ${purpose}`);
        return null;
      }

      // バリアントを取得（最新バージョンを選択）
      const promptVariants = await this.staticMasterService.getStaticMaster('prompt_variants');
      const selectedVariant = promptVariants
        .filter((x) => x.family_id === selectedFamily.id)
        .sort((a, b) => b.variant_number - a.variant_number)[0];

      if (!selectedVariant) {
        this.logger.warn(`No prompt variant found for family: ${selectedFamily.id}`);
        return null;
      }

      this.logger.debug(`Selected prompt family ${selectedFamily.id} variant ${selectedVariant.variant_number}`);
      return {
        family: selectedFamily,
        variant: selectedVariant,
      };

    } catch (error) {
      this.logger.error('Failed to get prompt for purpose', error);
      return null;
    }
  }

  /**
   * プロンプト使用履歴を記録
   */
  async createPromptUsage(params: Omit<Prisma.prompt_usagesCreateInput, 'id' | 'created_at' | 'created_request_id'>): Promise<void> {
    this.logger.debug('Creating prompt usage record', {
      family_id: params.family_id,
      variant_id: params.variant_id,
      target_type: params.target_type,
    });

    try {
      await this.prisma.prompt_usages.create({
        data: {
          id: crypto.randomUUID(),
          family_id: params.family_id,
          variant_id: params.variant_id,
          target_type: params.target_type,
          target_id: params.target_id,
          generated_text: params.generated_text,
          used_prompt_text: params.used_prompt_text,
          input_data: params.input_data,
          llm_model: params.llm_model,
          temperature: params.temperature,
          generated_user: params.generated_user,
          created_at: new Date(),
          created_request_id: this.cls.get<string>(CLS_KEY_REQUEST_ID),
          metadata: params.metadata,
        },
      });

      this.logger.debug('Prompt usage record created successfully');

    } catch (error) {
      this.logger.error('Failed to create prompt usage record', error);
      // Don't throw here - logging failure shouldn't break the main flow
    }
  }
}