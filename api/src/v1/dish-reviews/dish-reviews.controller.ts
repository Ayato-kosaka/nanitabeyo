// api/src/v1/dish-reviews/dish-reviews.controller.ts
//
// Controller for dish reviews endpoints
// Following the dish-media controller pattern

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

// Auth
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// Service
import { DishReviewsService } from './dish-reviews.service';

@ApiTags('DishReviews')
@Controller('v1/dish-reviews')
export class DishReviewsController {
  constructor(private readonly dishReviewsService: DishReviewsService) {}

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/dish-reviews                          */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: '料理レビュー登録' })
  @ApiResponse({ status: 201, description: 'レビュー作成成功' })
  async createDishReview(
    @Body() dto: CreateDishReviewDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDishReviewResponse> {
    await this.dishReviewsService.createDishReview(dto, user.userId);
  }

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-reviews/:id/likes/:userId                 */
  /* ------------------------------------------------------------------ */
  @Post(':id/likes/:userId')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レビューいいね追加' })
  @ApiParam({ name: 'id', required: true, description: 'レビューID' })
  @ApiParam({ name: 'userId', required: true, description: 'ユーザーID' })
  @ApiResponse({ status: 201, description: 'いいね追加成功' })
  async likeReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<LikeDishReviewResponse> {
    const params: LikeDishReviewParamsDto = { id, userId };
    await this.dishReviewsService.likeReview(params);
  }
}