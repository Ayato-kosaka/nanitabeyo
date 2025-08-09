// api/src/v1/dish-categories/dish-categories.controller.ts
//
// Controller for dish categories endpoints
// Following the pattern from dish-media/dish-media.controller.ts
//

import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';

import { QueryDishCategoryRecommendationsDto } from '@shared/v1/dto';
import { QueryDishCategoryRecommendationsResponse } from '@shared/v1/res';

// 横串 (Auth)
import { OptionalJwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { CLS_KEY_REQUEST_ID } from '../../core/cls/cls.constants';

// ドメイン Service
import { DishCategoriesService } from './dish-categories.service';

@ApiTags('DishCategories')
@Controller('v1/dish-categories')
export class DishCategoriesController {
  constructor(
    private readonly dishCategoriesService: DishCategoriesService,
    private readonly cls: ClsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/dish-categories/recommendations         */
  /* ------------------------------------------------------------------ */
  @Get('recommendations')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '料理カテゴリ提案' })
  @ApiQuery({
    name: 'location',
    required: true,
    description: '緯度経度 "lat,lng"',
  })
  @ApiQuery({ name: 'timeSlot', required: false, description: '時間帯' })
  @ApiQuery({ name: 'scene', required: false, description: 'シーン' })
  @ApiQuery({ name: 'mood', required: false, description: '気分' })
  @ApiQuery({ name: 'restrictions', required: false, description: '制限' })
  @ApiQuery({ name: 'distance', required: false, description: '距離 (m)' })
  @ApiQuery({ name: 'budgetMin', required: false, description: '最低予算' })
  @ApiQuery({ name: 'budgetMax', required: false, description: '最高予算' })
  @ApiQuery({
    name: 'languageTag',
    required: true,
    description: '出力言語 (IETF BCP 47準拠, 例: en-US, ja-JP, fr-CA)',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getRecommendations(
    @Query() query: QueryDishCategoryRecommendationsDto,
  ): Promise<QueryDishCategoryRecommendationsResponse> {
    return this.dishCategoriesService.getRecommendations(query);
  }
}
