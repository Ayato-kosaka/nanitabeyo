// api/src/v1/contribution-tasks/contribution-tasks.controller.ts
//
// 🎯 目的
//   • /v1/contribution-tasks エンドポイントを提供
//   • ユーザー協力タスクの記録・取得を担当
//   • 認証必須（匿名ユーザーも可）で user_id を自動設定
//

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';

import {
  CreateContributionTaskDto,
  ListContributionTasksQueryDto,
  ExistsContributionTaskQueryDto,
  CompletedTargetIdsQueryDto,
} from '@shared/v1/dto';
import {
  CreateContributionTaskResponse,
  ListContributionTasksResponse,
  GetContributionTaskByIdResponse,
  ExistsContributionTaskResponse,
  CompletedTargetIdsResponse,
} from '@shared/v1/res';

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
  @UseGuards(AuthAnonGuard) // #699 【設計】認証必須（匿名ユーザーも可）
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'ユーザー協力タスクの結果を記録',
    description:
      '企画単位でユーザーの協力・フィードバックを事実ログとして保存する',
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
    // #699 【設計】user_id は認証情報から設定され、bodyで上書きできない
    return this.contributionTasksService.createContributionTask(dto, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*          GET /v1/contribution-tasks (認証必須: 自分の履歴)         */
  /* ------------------------------------------------------------------ */
  @Get()
  @UseGuards(AuthAnonGuard) // #701 【設計】認証必須（匿名ユーザーも可）
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: '自分の協力タスク履歴を取得',
    description: '認証ユーザー自身が過去に完了した協力タスクの一覧を取得する',
  })
  @ApiQuery({
    name: 'taskKey',
    required: false,
    description: 'タスクキーでフィルタ',
  })
  @ApiQuery({ name: 'type', required: false, description: 'タイプでフィルタ' })
  @ApiQuery({
    name: 'targetType',
    required: false,
    description: '対象タイプでフィルタ',
  })
  @ApiQuery({
    name: 'targetId',
    required: false,
    description: '対象IDでフィルタ',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: '作成日時の開始（ISO8601）',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: '作成日時の終了（ISO8601）',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '取得件数（1-100、デフォルト20）',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'ページングカーソル',
  })
  @ApiQuery({
    name: 'include',
    required: false,
    description: 'payload,result を含める場合は "payload,result"',
  })
  @ApiResponse({
    status: 200,
    description: '協力タスク履歴の取得成功',
  })
  @ApiResponse({
    status: 401,
    description: '認証エラー',
  })
  async listContributionTasks(
    @Query() query: ListContributionTasksQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ListContributionTasksResponse> {
    // #701 【設計】自分のレコードだけ取得
    return this.contributionTasksService.list(query, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*        GET /v1/contribution-tasks/exists (認証必須: 二重防止)      */
  /* ------------------------------------------------------------------ */
  @Get('exists')
  @UseGuards(AuthAnonGuard) // #701 【設計】認証必須（匿名ユーザーも可）
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: '協力タスクの二重送信防止チェック',
    description: '自分が既に特定の協力タスクを完了しているか確認する',
  })
  @ApiQuery({ name: 'taskKey', required: true, description: 'タスクキー' })
  @ApiQuery({ name: 'targetType', required: true, description: '対象タイプ' })
  @ApiQuery({ name: 'targetId', required: true, description: '対象ID' })
  @ApiQuery({ name: 'type', required: false, description: 'タイプ（任意）' })
  @ApiResponse({
    status: 200,
    description: '存在チェック成功',
  })
  @ApiResponse({
    status: 400,
    description: 'バリデーションエラー',
  })
  @ApiResponse({
    status: 401,
    description: '認証エラー',
  })
  async existsContributionTask(
    @Query() query: ExistsContributionTaskQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ExistsContributionTaskResponse> {
    // #701 【設計】自分のレコードだけを対象に判定
    return this.contributionTasksService.exists(query, user.id);
  }

  /* ------------------------------------------------------------------ */
  /* GET /v1/contribution-tasks/completed-target-ids (公開: グローバル) */
  /* ------------------------------------------------------------------ */
  @Get('completed-target-ids')
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: 'グローバル完了済みtargetId一覧を取得',
    description:
      '誰かが完了した targetId の集計情報を取得する（個人特定情報は含まない）',
  })
  @ApiQuery({ name: 'taskKey', required: true, description: 'タスクキー' })
  @ApiQuery({ name: 'targetType', required: true, description: '対象タイプ' })
  @ApiQuery({ name: 'type', required: false, description: 'タイプ（任意）' })
  @ApiQuery({
    name: 'minCount',
    required: false,
    description: '最小完了回数（デフォルト1）',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '取得件数（1-1000、デフォルト200）',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'ページングカーソル',
  })
  @ApiResponse({
    status: 200,
    description: '完了済みtargetId一覧の取得成功',
  })
  @ApiResponse({
    status: 400,
    description: 'バリデーションエラー',
  })
  async completedTargetIds(
    @Query() query: CompletedTargetIdsQueryDto,
  ): Promise<CompletedTargetIdsResponse> {
    // #701 【設計】認証不要（公開）だが、個人特定情報は返さない
    return this.contributionTasksService.completedTargetIds(query);
  }

  /* ------------------------------------------------------------------ */
  /*       GET /v1/contribution-tasks/:id (認証必須: 詳細取得)          */
  /* ------------------------------------------------------------------ */
  @Get(':id')
  @UseGuards(AuthAnonGuard) // #701 【設計】認証必須（匿名ユーザーも可）
  @ApiBearerAuth()
  @ApiOperation({
    summary: '協力タスクの詳細を取得',
    description:
      '自分が完了した協力タスクの詳細情報を取得する（payload/result を含む）',
  })
  @ApiResponse({
    status: 200,
    description: '協力タスクの詳細取得成功',
  })
  @ApiResponse({
    status: 401,
    description: '認証エラー',
  })
  @ApiResponse({
    status: 404,
    description: '協力タスクが見つからない（または他人のレコード）',
  })
  async getContributionTaskById(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<GetContributionTaskByIdResponse> {
    // #701 【設計】自分のレコードのみ取得（他人は404）
    return this.contributionTasksService.getById(id, user.id);
  }
}
