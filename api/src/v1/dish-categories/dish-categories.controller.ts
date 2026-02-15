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
import { AuthAnonGuard } from '../../core/auth/auth.guard';
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
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '料理カテゴリ提案' })
  @ApiQuery({
    name: 'address',
    required: true,
    description: '住所',
  })
  @ApiQuery({ name: 'timeSlot', required: false, description: '時間帯' })
  @ApiQuery({ name: 'scene', required: false, description: 'シーン' })
  @ApiQuery({ name: 'mood', required: false, description: '気分' })
  @ApiQuery({
    name: 'languageTag',
    required: true,
    description: '出力言語 (IETF BCP 47準拠, 例: en-US, ja-JP, fr-CA)',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getRecommendations(
    @Query() query: QueryDishCategoryRecommendationsDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<QueryDishCategoryRecommendationsResponse> {
    // #[TICKET] 【設計】userId を service に伝搬して block/hide 除外に利用
    return this.dishCategoriesService.getRecommendations(query, user?.id);
  }
}
