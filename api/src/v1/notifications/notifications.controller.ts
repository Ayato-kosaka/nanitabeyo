// api/src/v1/notifications/notifications.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❷ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ "認証必須" を Guard で明確化
// ❹ Swagger / OpenAPI デコレータで自動ドキュメント化
//

import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { QueryNotificationsDto } from '@shared/v1/dto';
import {
  QueryNotificationsResponse,
  MarkAllReadResponse,
  UnreadCountResponse,
} from '@shared/v1/res';

import { JwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { NotificationsService } from './notifications.service';
import { Response } from 'express';

@ApiTags('Notifications')
@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) { }

  /* ------------------------------------------------------------------ */
  /*                      GET /v1/notifications                         */
  /* ------------------------------------------------------------------ */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: '通知一覧取得（キーセットページング）- スレッド更新順',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'ページングカーソル（{thread_updated_at}_{notificationId}）',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '取得件数（1–100、デフォルト30）',
  })
  @ApiResponse({
    status: 200,
    description: '取得成功 - 各通知に先頭3件のアクター情報を含む',
  })
  async getNotifications(
    @Query() query: QueryNotificationsDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QueryNotificationsResponse> {
    const result = await this.notificationsService.getNotifications(
      user.id,
      query,
    );

    return {
      data: result.items,
      nextCursor: result.nextCursor,
    };
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/notifications/mark-all-read                  */
  /* ------------------------------------------------------------------ */
  @Post('mark-all-read')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '通知を一括既読（カーソル更新）' })
  @ApiResponse({ status: 200, description: '既読成功' })
  async markAllAsRead(
    @CurrentUser() user: RequestUser,
  ): Promise<MarkAllReadResponse> {
    return this.notificationsService.markAllAsRead(user.id);
  }

  /* ------------------------------------------------------------------ */
  /*              GET /v1/notifications/unread-count                    */
  /* ------------------------------------------------------------------ */
  @Get('unread-count')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '未読通知数を取得（thread_updated_at > last_read_at）',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getUnreadCount(
    @CurrentUser() user: RequestUser,
  ): Promise<UnreadCountResponse> {
    return this.notificationsService.getUnreadCount(user.id);
  }
}
