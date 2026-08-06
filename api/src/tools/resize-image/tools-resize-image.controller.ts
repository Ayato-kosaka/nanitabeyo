// api/src/tools/resize-image/tools-resize-image.controller.ts
//
// Controller for tools resize-image endpoints
// #514 【設計】運営用ツール - 失敗したリサイズジョブの再実行
//

import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

// 認証
import { AuthAnonGuard, PermissionGuard } from '../../core/auth/auth.guard';
import { Permissions } from 'src/core/auth/auth.utils';

// DTO / Response
import { ReEnqueueResizeImageDto } from '@shared/v1/dto';
import { ReEnqueueResizeImageResponse } from '@shared/v1/res';

// Service
import { ToolsResizeImageService } from './tools-resize-image.service';

@ApiTags('Tools - ResizeImage')
@Controller('tools/resize-image')
export class ToolsResizeImageController {
  constructor(
    private readonly toolsResizeImageService: ToolsResizeImageService,
  ) {}

  /**
   * #514 失敗したリサイズジョブの再 enqueue
   * POST /tools/resize-image/re-enqueue
   */
  @Post('re-enqueue')
  @UseGuards(AuthAnonGuard, PermissionGuard)
  @Permissions('tools.resize-image.re-enqueue')
  @ApiOperation({
    summary: 'リサイズジョブの再 enqueue',
    description:
      '恒久失敗としてキューから取り除いた分を再実行する。対象は recordId で明示指定（最大100件）。全件再実行はできない。',
  })
  @ApiResponse({
    status: 201,
    description: '再 enqueue 結果',
  })
  async reEnqueue(
    @Body() dto: ReEnqueueResizeImageDto,
  ): Promise<ReEnqueueResizeImageResponse> {
    return this.toolsResizeImageService.reEnqueue(dto);
  }
}
