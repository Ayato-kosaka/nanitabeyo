// api/src/v1/device-tokens/device-tokens.controller.ts
//
// ❶ デバイストークン登録エンドポイント（要認証）
// ❷ Expo Push Token を Backend 経由で user_device_tokens に upsert
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

import { CreateDeviceTokenDto } from '@shared/v1/dto';
import { CreateDeviceTokenResponse } from '@shared/v1/res';

import { AuthUserGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';

@ApiTags('DeviceTokens')
@Controller('v1/device-tokens')
export class DeviceTokensController {
  constructor(private readonly notificationsService: NotificationsService) { }

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/device-tokens                          */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'デバイストークン登録/更新（要ログイン）' })
  @ApiResponse({ status: 200, description: '登録成功' })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  async createDeviceToken(
    @Body() dto: CreateDeviceTokenDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDeviceTokenResponse> {
    return this.notificationsService.createDeviceToken(
      user.id,
      dto.expoPushToken,
    );
  }
}
