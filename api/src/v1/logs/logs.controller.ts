// api/src/v1/logs/logs.controller.ts
//
// #489 【設計】フロントログ送信経路変更（Supabase → Backend API 経由）
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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateFrontendLogDto } from '@shared/v1/dto';
import { CreateFrontendLogResponseDto } from '@shared/v1/res';

// 横串 (Auth)
import { OptionalJwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { LogsService } from './logs.service';

@ApiTags('Logs')
@Controller('v1/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/logs/frontend (任意認証)               */
  /* ------------------------------------------------------------------ */
  @Post('frontend')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'フロントエンドログを Cloud Logging へ送信' })
  @ApiResponse({ status: 201, description: 'ログ受信成功' })
  async createFrontendLog(
    @Body() dto: CreateFrontendLogDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<CreateFrontendLogResponseDto> {
    return this.logsService.createFrontendLog(dto, user?.id);
  }
}
