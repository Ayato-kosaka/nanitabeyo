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
import { JwtAuthGuard } from '../../core/auth/auth.guard';

// DTO / Response
import { UpdateDishCategoryImagesDto } from '@shared/v1/dto';
import {
  PopularDishCategoriesWithMediaResponse,
  UpdateDishCategoryImagesResponse,
  UpdateDishCategoryImagesErrorResponse,
} from '@shared/v1/res';

// Service
import { ToolsDishCategoriesService } from './tools-dish-categories.service';

@ApiTags('Tools - DishCategories')
@Controller('tools/dish-categories')
@UseGuards(JwtAuthGuard)
export class ToolsDishCategoriesController {
  constructor(
    private readonly toolsDishCategoriesService: ToolsDishCategoriesService,
  ) {}

  /**
   * #494 【API①】よく使われるカテゴリ + 候補画像取得
   * GET /tools/dish-categories/popular-with-media
   */
  @Get('popular-with-media')
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

  /**
   * #494 【API②】選択されたメディアでカテゴリ画像を一括更新
   * POST /tools/dish-categories/update-images
   */
  @Post('update-images')
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: 'カテゴリ画像一括更新',
    description:
      '選択されたdish_mediaのサムネイルでdish_categories.image_urlを更新',
  })
  @ApiResponse({
    status: 200,
    description: '更新成功',
  })
  @ApiResponse({
    status: 400,
    description: 'バリデーションエラー',
  })
  async updateCategoryImages(
    @Body() dto: UpdateDishCategoryImagesDto,
  ): Promise<
    UpdateDishCategoryImagesResponse | UpdateDishCategoryImagesErrorResponse
  > {
    return this.toolsDishCategoriesService.updateCategoryImages(dto);
  }
}
