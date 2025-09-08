// api/src/v1/user-uploads/user-uploads.controller.ts
//
// ❶ Controller for user-uploads endpoints
// ❷ Following the pattern from dish-media/dish-media.controller.ts
// ❸ Handles signed URL generation for user file uploads

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

import { CreateUserUploadSignedUrlDto } from '@shared/v1/dto';
import { CreateUserUploadSignedUrlResponse } from '@shared/v1/res';

// 横串 (Auth)
import { JwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { UserUploadsService } from './user-uploads.service';

@ApiTags('UserUploads')
@Controller('v1/user-uploads')
export class UserUploadsController {
  constructor(private readonly userUploadsService: UserUploadsService) {}

  /* ------------------------------------------------------------------ */
  /*                POST /v1/user-uploads/signed-url                    */
  /* ------------------------------------------------------------------ */
  @Post('signed-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'GCS 署名付き URL 発行' })
  @ApiResponse({ status: 201, description: '署名付きURL生成成功' })
  @ApiResponse({ status: 401, description: '認証が必要' })
  async createSignedUrl(
    @Body() dto: CreateUserUploadSignedUrlDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateUserUploadSignedUrlResponse> {
    // 認証済みユーザーのファイルアップロード用署名付きURL生成
    return this.userUploadsService.createSignedUrl(dto, user.userId);
  }
}
