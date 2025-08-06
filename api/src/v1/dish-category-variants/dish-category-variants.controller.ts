// api/src/v1/dish-category-variants/dish-category-variants.controller.ts
//
// Controller for dish category variants endpoints
// Following the pattern from dish-media/dish-media.controller.ts
//

import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  QueryDishCategoryVariantsDto,
  CreateDishCategoryVariantDto,
} from '@shared/v1/dto';
import {
  QueryDishCategoryVariantsResponse,
  CreateDishCategoryVariantResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { OptionalJwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { DishCategoryVariantsService } from './dish-category-variants.service';
import { convertPrismaToSupabase_DishCategories } from '../../../../shared/converters/convert_dish_categories';

@ApiTags('DishCategoryVariants')
@Controller('v1/dish-category-variants')
export class DishCategoryVariantsController {
  constructor(
    private readonly dishCategoryVariantsService: DishCategoryVariantsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/dish-category-variants                  */
  /* ------------------------------------------------------------------ */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '料理カテゴリ表記揺れ取得' })
  @ApiQuery({
    name: 'q',
    required: true,
    description: '検索語',
  })
  @ApiQuery({ name: 'lang', required: false, description: '言語コード' })
  @ApiResponse({ status: 200, description: '取得成功' })
  async findDishCategoryVariants(
    @Query() query: QueryDishCategoryVariantsDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<QueryDishCategoryVariantsResponse> {
    return this.dishCategoryVariantsService.findDishCategoryVariants(query);
  }

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/dish-category-variants                 */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: '料理カテゴリ表記揺れ登録' })
  @ApiResponse({ status: 201, description: '登録成功' })
  @ApiResponse({
    status: 500,
    description: 'マッチする料理カテゴリが見つからない',
  })
  async createDishCategoryVariant(
    @Body() dto: CreateDishCategoryVariantDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<CreateDishCategoryVariantResponse> {
    return convertPrismaToSupabase_DishCategories(
      await this.dishCategoryVariantsService.createDishCategoryVariant(dto),
    );
  }
}
