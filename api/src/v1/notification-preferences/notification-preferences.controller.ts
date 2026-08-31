// api/src/v1/notification-preferences/notification-preferences.controller.ts
//
// ❶ #1510 SET-02 通知カテゴリ別の受信設定（要ログイン）
// ❷ ルートは `me/blocked-dish-categories` と同じ「自分専用サブリソース」の作法に揃える
// ❸ ただしファイル・Provider は notifications ドメイン側に置く。
//    UsersController に置くと UsersModule → NotificationsModule → UsersModule の
//    循環参照になり forwardRef が必要になるため（DeviceTokensController と同じ回避策）
//

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  UpdateNotificationPreferenceDto,
  UpdateNotificationPreferenceParamsDto,
} from '@shared/v1/dto';
import {
  QueryMeNotificationPreferencesResponse,
  UpdateMeNotificationPreferenceResponse,
} from '@shared/v1/res';

import { AuthUserGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';

@ApiTags('NotificationPreferences')
@Controller('v1/users/me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /* ------------------------------------------------------------------ */
  /*         GET /v1/users/me/notification-preferences                  */
  /* ------------------------------------------------------------------ */
  @Get()
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: '通知カテゴリ別の受信設定を取得（未設定は既定値で埋めて返す）',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMyNotificationPreferences(
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeNotificationPreferencesResponse> {
    return this.notificationsService.getMyNotificationPreferences(user.id);
  }

  /* ------------------------------------------------------------------ */
  /*   PATCH /v1/users/me/notification-preferences/:category            */
  /* ------------------------------------------------------------------ */
  @Patch(':category')
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: '通知カテゴリ 1 件の受信設定を更新（トグル 1 回 = 1 リクエスト）',
  })
  @ApiParam({
    name: 'category',
    description: '通知カテゴリ key（likes / saves / group_votes）',
  })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 400, description: '未知のカテゴリ / 不正なボディ' })
  async updateMyNotificationPreference(
    @Param() params: UpdateNotificationPreferenceParamsDto,
    @Body() dto: UpdateNotificationPreferenceDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UpdateMeNotificationPreferenceResponse> {
    return this.notificationsService.updateMyNotificationPreference(
      user.id,
      params.category,
      dto.enabled,
    );
  }
}
