// api/src/v1/contribution-tasks/contribution-tasks.controller.ts
//
// 🎯 目的
//   • POST /v1/contribution-tasks エンドポイントを提供
//   • ユーザー協力タスクの結果を受け取り、Service に処理を委譲
//   • 認証必須（匿名ユーザーも可）で user_id を自動設定
//

import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CreateContributionTaskDto } from '@shared/v1/dto';
import { CreateContributionTaskResponse } from '@shared/v1/res';

// 横串 (Auth)
import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { ContributionTasksService } from './contribution-tasks.service';

@ApiTags('ContributionTasks')
@Controller('v1/contribution-tasks')
export class ContributionTasksController {
  constructor(
    private readonly contributionTasksService: ContributionTasksService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                POST /v1/contribution-tasks (認証必須)              */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(AuthAnonGuard) // #669 【設計】認証必須（匿名ユーザーも可）
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'ユーザー協力タスクの結果を記録',
    description: '企画単位でユーザーの協力・フィードバックを事実ログとして保存する',
  })
  @ApiResponse({
    status: 201,
    description: '協力タスクの記録成功',
  })
  @ApiResponse({
    status: 400,
    description: 'バリデーションエラー',
  })
  @ApiResponse({
    status: 401,
    description: '認証エラー',
  })
  async createContributionTask(
    @Body() dto: CreateContributionTaskDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateContributionTaskResponse> {
    // #669 【設計】user_id は認証情報から設定され、bodyで上書きできない
    return this.contributionTasksService.createContributionTask(dto, user.id);
  }
}
