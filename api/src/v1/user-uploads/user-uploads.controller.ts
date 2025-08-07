// api/src/v1/user-uploads/user-uploads.controller.ts
//
// ❶ GCS 署名付き URL 発行 API
// ❷ 認証必須（JwtAuthGuard）
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
  /*              POST /v1/user-uploads/signed-url                      */
  /* ------------------------------------------------------------------ */
  @Post('signed-url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'GCS 署名付き URL 発行' })
  @ApiResponse({ status: 201, description: '作成成功' })
  async createSignedUrl(
    @Body() dto: CreateUserUploadSignedUrlDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateUserUploadSignedUrlResponse> {
    return this.userUploadsService.createSignedUrl(dto, user.userId);
  }
}
