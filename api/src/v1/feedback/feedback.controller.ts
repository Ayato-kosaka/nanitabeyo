// api/src/v1/feedback/feedback.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❷ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ "認証必須 / 任意" を Guard で明確化
// ❹ Swagger / OpenAPI デコレータで自動ドキュメント化
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

import { CreateFeedbackDto } from '@shared/v1/dto';
import { CreateFeedbackResponseDto } from '@shared/v1/res';

// 横串 (Auth)
import { OptionalJwtAuthGuard } from '../../core/auth/auth.guard';

// ドメイン Service
import { FeedbackService } from './feedback.service';

@ApiTags('Feedback')
@Controller('v1/feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/feedback/issue (任意認証)              */
  /* ------------------------------------------------------------------ */
  @Post('issue')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'GitHub Issue 作成 (フィードバック/バグ報告)' })
  @ApiResponse({ status: 201, description: 'Issue 作成成功' })
  async createIssue(
    @Body() dto: CreateFeedbackDto,
  ): Promise<CreateFeedbackResponseDto> {
    return this.feedbackService.createIssue(dto);
  }
}
