// api/src/v1/logs/logs.controller.ts
//
// #487 【設計】フロントログ送信経路変更（Prisma 廃止 / Cloud Logging 対応）
// POST /v1/logs/frontend エンドポイントの実装
//

import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CreateFrontendLogDto,
  CreateFrontendLogBatchDto,
} from '@shared/v1/dto';
import {
  CreateFrontendLogBatchResponseDto,
  CreateFrontendLogResponseDto,
} from '@shared/v1/res';

// #1079 バッチの要素単位検証（部分受理）
import {
  FrontendLogBatchValidationPipe,
  ValidatedFrontendLogBatch,
} from './frontend-log-batch.pipe';

// 横串 (Auth)
import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { LogsService } from './logs.service';

@ApiTags('Logs')
@Controller('v1/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/logs/frontend                          */
  /* ------------------------------------------------------------------ */
  @Post('frontend')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'フロントエンドログを Cloud Logging へ出力',
  })
  @ApiResponse({ status: 201, description: 'ログ受信成功' })
  async createFrontendLog(
    @Body() dto: CreateFrontendLogDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateFrontendLogResponseDto> {
    return this.logsService.createFrontendLog(dto, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*                POST /v1/logs/frontend/batch                        */
  /* ------------------------------------------------------------------ */
  // #1011 【設計】クライアント側のキュー化・バッチ送信(#1012)が本エンドポイントを利用する
  @Post('frontend/batch')
  @UseGuards(AuthAnonGuard)
  // #1079 ValidationPipe を差し替え。封筒(logs 配列そのもの)の検証は pipe 内部で
  //       標準 ValidationPipe へ委譲し、要素は 1 件ずつ検証して部分受理する
  @UsePipes(new FrontendLogBatchValidationPipe())
  // #1079 @Body() の宣言型が interface になると emit される metatype が Object になり
  //       Swagger の body 型推論が失われるため明示する
  @ApiBody({ type: CreateFrontendLogBatchDto })
  @ApiOperation({
    summary: 'フロントエンドログを配列でまとめて Cloud Logging へ出力',
  })
  @ApiResponse({
    status: 201,
    description: 'ログ受信成功（要素単位で部分受理）',
  })
  async createFrontendLogBatch(
    @Body() batch: ValidatedFrontendLogBatch,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateFrontendLogBatchResponseDto> {
    return this.logsService.createFrontendLogBatch(
      batch.accepted,
      user.id,
      batch.rejected,
    );
  }
}
