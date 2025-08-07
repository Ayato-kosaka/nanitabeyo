// api/src/v1/dish-reviews/dish-reviews.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❷ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ "認証必須 / 任意" を Guard で明確化
// ❹ Swagger / OpenAPI デコレータで自動ドキュメント化
//

import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
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
  CreateDishReviewDto,
  LikeDishReviewParamsDto,
} from '@shared/v1/dto';
import {
  CreateDishReviewResponse,
  LikeDishReviewResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { DishReviewsService } from './dish-reviews.service';

@ApiTags('DishReviews')
@Controller('v1/dish-reviews')
export class DishReviewsController {
  constructor(private readonly dishReviewsService: DishReviewsService) {}

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/dish-reviews (認証必須)                */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: '料理レビュー登録' })
  @ApiResponse({ status: 201, description: 'レビュー登録成功' })
  async createDishReview(
    @Body() dto: CreateDishReviewDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDishReviewResponse> {
    return this.dishReviewsService.createDishReview(dto, user.userId);
  }

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-reviews/:id/likes/:userId                 */
  /* ------------------------------------------------------------------ */
  @Post(':id/likes/:userId')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レビューいいね追加' })
  @ApiParam({ name: 'id', required: true, description: 'dish_reviews.id' })
  @ApiParam({ name: 'userId', required: true, description: 'users.id' })
  @ApiResponse({ status: 201, description: 'いいね追加成功' })
  async likeDishReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<LikeDishReviewResponse> {
    const params: LikeDishReviewParamsDto = { id, userId };
    return this.dishReviewsService.likeDishReview(params);
  }
}