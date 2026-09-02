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
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
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
  UpdateDishReviewDto,
} from '@shared/v1/dto';
import {
  CreateDishReviewResponse,
  DeleteDishReviewResponse,
  LikeDishReviewResponse,
  UpdateDishReviewResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { AuthUserGuard, AuthAnonGuard } from '../../core/auth/auth.guard';
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
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: '料理レビュー登録' })
  @ApiResponse({
    status: 201,
    description: 'レビュー登録成功',
    type: Object,
  })
  async createDishReview(
    @Body() dto: CreateDishReviewDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDishReviewResponse> {
    return this.dishReviewsService.createDishReview(dto, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*            PATCH /v1/dish-reviews/:id (認証必須) #1513              */
  /* ------------------------------------------------------------------ */
  /**
   * #1513 自分のレビューのテキスト系項目だけを更新する。
   *
   * `AuthAnonGuard` ではなく `AuthUserGuard` を使う。匿名ユーザーは投稿できないので、
   * 匿名のまま編集できる余地を残す必要が無い。
   *
   * ValidationPipe の `whitelist: true` は必須。これがあることで、DTO に無い
   * メディア系フィールド（media_path / createdDishMediaId 等）は握り潰される。
   */
  @Patch(':id')
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: '料理レビュー編集（テキスト等のみ。メディアは差し替え不可）',
  })
  @ApiParam({ name: 'id', required: true, description: 'dish_reviews.id' })
  @ApiResponse({ status: 200, description: '編集成功' })
  @ApiResponse({ status: 403, description: '自分のレビューではない' })
  @ApiResponse({ status: 404, description: '存在しない / 削除済み' })
  @ApiResponse({ status: 409, description: 'lock_no 不一致（同時編集）' })
  async updateDishReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDishReviewDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UpdateDishReviewResponse> {
    return this.dishReviewsService.updateDishReview(id, dto, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*            DELETE /v1/dish-reviews/:id (認証必須) #1513             */
  /* ------------------------------------------------------------------ */
  /**
   * #1513 自分のレビューを論理削除する。消えるのはレビュー 1 件だけで、
   * 紐づく dish_media は残る（投稿ごと消すのは DELETE /v1/dish-media/:id）。
   */
  @Delete(':id')
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '料理レビュー削除（論理削除）' })
  @ApiParam({ name: 'id', required: true, description: 'dish_reviews.id' })
  @ApiResponse({ status: 200, description: '削除成功' })
  @ApiResponse({ status: 403, description: '自分のレビューではない' })
  @ApiResponse({ status: 404, description: '存在しない' })
  async deleteDishReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DeleteDishReviewResponse> {
    return this.dishReviewsService.deleteDishReview(id, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-reviews/:id/likes                         */
  /* ------------------------------------------------------------------ */
  @Post(':id/likes')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レビューいいね追加' })
  @ApiParam({ name: 'id', required: true, description: 'dish_reviews.id' })
  @ApiResponse({ status: 201, description: 'いいね追加成功' })
  async likeDishReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<LikeDishReviewResponse> {
    const params: LikeDishReviewParamsDto = { id };
    return this.dishReviewsService.likeDishReview(
      params,
      user.id,
      user.isAnonymous,
    );
  }

  /* ------------------------------------------------------------------ */
  /*            DELETE /v1/dish-reviews/:id/likes                       */
  /* ------------------------------------------------------------------ */
  @Delete(':id/likes')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レビューいいね解除' })
  @ApiParam({ name: 'id', required: true, description: 'dish_reviews.id' })
  @ApiResponse({ status: 200, description: 'いいね解除成功' })
  async unlikeDishReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<LikeDishReviewResponse> {
    const params: LikeDishReviewParamsDto = { id };
    return this.dishReviewsService.unlikeDishReview(params, user.id);
  }
}
