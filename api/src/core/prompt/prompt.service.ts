// api/src/core/prompt/prompt.service.ts
//
// Prompt service for managing prompt families, variants, and usage logging
//

import { Injectable } from '@nestjs/common';
import { StaticMasterService } from '../utils/static-master.service';
import { pickByWeight } from '../utils/weight.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../../shared/prisma';
import { CLS_KEY_REQUEST_ID } from '../cls/cls.constants';
import { ClsService } from 'nestjs-cls';
import { AppLoggerService } from '../logger/logger.service';

@Injectable()
export class PromptService {
  constructor(
    private readonly staticMasterService: StaticMasterService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly logger: AppLoggerService,
  ) { }

  /**
   * プロンプトファミリーとバリアントを取得し、重み付け選択を行う
   */
  async getPromptForPurpose(purpose: string) {
    this.logger.debug('GetPromptForPurpose', 'getPromptForPurpose', {
      purpose,
    });

    try {
      // Static Masterからプロンプトファミリーを取得
      const promptFamilies =
        await this.staticMasterService.getStaticMaster('prompt_families');
      const eligibleFamilies = promptFamilies
        .filter((x) => x.purpose === purpose)
        .filter((x) => x.weight > 0);

      if (eligibleFamilies.length === 0) {
        this.logger.warn('NoEligiblePromptFamilies', 'getPromptForPurpose', {
          purpose,
        });
        return null;
      }

      // 重み付け選択でファミリーを選択
      const selectedFamily = pickByWeight(eligibleFamilies);
      if (!selectedFamily) {
        this.logger.warn('PromptFamilySelectionFailed', 'getPromptForPurpose', {
          purpose,
        });
        return null;
      }

      // バリアントを取得（最新バージョンを選択）
      const promptVariants =
        await this.staticMasterService.getStaticMaster('prompt_variants');
      const selectedVariant = promptVariants
        .filter((x) => x.family_id === selectedFamily.id)
        .sort((a, b) => b.variant_number - a.variant_number)[0];

      if (!selectedVariant) {
        this.logger.warn('NoPromptVariantFound', 'getPromptForPurpose', {
          familyId: selectedFamily.id,
        });
        return null;
      }

      this.logger.debug('PromptVariantSelected', 'getPromptForPurpose', {
        familyId: selectedFamily.id,
        variantNumber: selectedVariant.variant_number,
      });
      return {
        family: selectedFamily,
        variant: selectedVariant,
      };
    } catch (error) {
      this.logger.error('GetPromptForPurposeError', 'getPromptForPurpose', {
        error_message: error instanceof Error ? error.message : String(error),
        purpose,
      });
      return null;
    }
  }

  /**
   * プロンプト使用履歴を記録
   */
  async createPromptUsage(
    params: Omit<
      Prisma.prompt_usagesCreateInput,
      'id' | 'created_at' | 'created_request_id'
    >,
  ): Promise<void> {
    this.logger.debug('CreatePromptUsage', 'createPromptUsage', {
      family_id: params.family_id,
      variant_id: params.variant_id,
      target_type: params.target_type,
    });

    try {
      await this.prisma.prisma.prompt_usages.create({
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

      this.logger.debug('PromptUsageCreated', 'createPromptUsage', {});
    } catch (error) {
      this.logger.error('CreatePromptUsageError', 'createPromptUsage', {
        error_message: error instanceof Error ? error.message : String(error),
      });
      // Don't throw here - logging failure shouldn't break the main flow
    }
  }
}
