// api/src/ops/resize-image/ops-resize-image.controller.ts
//
// Controller for operational resize-image endpoints
// #514 【設計】運用操作 - 失敗したリサイズジョブの再実行
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
import { OpsResizeImageService } from './ops-resize-image.service';

@ApiTags('Ops - ResizeImage')
@Controller('ops/resize-image')
export class OpsResizeImageController {
  constructor(private readonly opsResizeImageService: OpsResizeImageService) {}

  /**
   * #514 失敗したリサイズジョブの再 enqueue
   * POST /ops/resize-image/re-enqueue
   */
  @Post('re-enqueue')
  @UseGuards(AuthAnonGuard, PermissionGuard)
  // #514 【注意】permission 名だけ route と語順が逆（`image-resize` / `resize-image`）。
  // 本番の `permissions` には `ops.image-resize.re-enqueue` の行が既に入っており、
  // 名前が食い違うと `Missing permission` で 403 になる。route に合わせて
  // 「直す」場合は、必ず DB 側の行とロール割り当ても同時に張り替えること。
  @Permissions('ops.image-resize.re-enqueue')
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
    return this.opsResizeImageService.reEnqueue(dto);
  }
}
