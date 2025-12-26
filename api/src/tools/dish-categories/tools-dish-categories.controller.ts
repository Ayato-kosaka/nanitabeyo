// api/src/tools/dish-categories/tools-dish-categories.controller.ts
//
// Controller for tools dish categories endpoints
// #494 【設計】運営用ツール - dish_categories画像最適化
//

import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

// 認証
import { AuthAnonGuard, PermissionGuard } from '../../core/auth/auth.guard';

// DTO / Response
import { PopularDishCategoriesWithMediaResponse } from '@shared/v1/res';

// Service
import { ToolsDishCategoriesService } from './tools-dish-categories.service';
import { Permissions } from 'src/core/auth/auth.utils';

@ApiTags('Tools - DishCategories')
@Controller('tools/dish-categories')
export class ToolsDishCategoriesController {
  constructor(
    private readonly toolsDishCategoriesService: ToolsDishCategoriesService,
  ) {}

  /**
   * #494 よく使われるカテゴリ + 候補画像取得
   * GET /tools/dish-categories/popular-with-media
   */
  @Get('popular-with-media')
  @UseGuards(AuthAnonGuard, PermissionGuard)
  @Permissions('tools.dish-categories.popular-with-media')
  @ApiOperation({
    summary: '人気カテゴリと候補メディア一覧取得',
    description:
      'Wikimedia画像を持つ人気dish_categoriesと、それに紐づくdish_media候補を取得',
  })
  @ApiResponse({
    status: 200,
    description: '取得成功',
  })
  async getPopularCategoriesWithMedia(): Promise<PopularDishCategoriesWithMediaResponse> {
    return this.toolsDishCategoriesService.getPopularCategoriesWithMedia();
  }
}
