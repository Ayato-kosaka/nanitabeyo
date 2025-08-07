// api/src/v1/users/users.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❷ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ "認証必須 / 任意" を Guard で明確化
// ❄ Swagger / OpenAPI デコレータで自動ドキュメント化
//

import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  UserIdParamsDto,
  QueryUserDishReviewsDto,
  QueryMeLikedDishMediaDto,
  QueryMePayoutsDto,
  QueryMeRestaurantBidsDto,
  QueryMeSavedDishCategoriesDto,
  QueryMeSavedDishMediaDto,
} from '@shared/v1/dto';
import {
  QueryUserDishReviewsResponse,
  QueryMeLikedDishMediaResponse,
  QueryMePayoutsResponse,
  QueryMeRestaurantBidsResponse,
  QueryMeSavedDishCategoriesResponse,
  QueryMeSavedDishMediaResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { UsersService } from './users.service';
import { UsersMapper } from './users.mapper';

@ApiTags('Users')
@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly usersMapper: UsersMapper,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/:id/dish-reviews                     */
  /* ------------------------------------------------------------------ */
  @Get(':id/dish-reviews')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レビューした料理投稿一覧' })
  @ApiParam({ name: 'id', required: true, description: 'ユーザーID' })
  @ApiQuery({ name: 'cursor', required: false, description: 'カーソル' })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getUserDishReviews(
    @Param() params: UserIdParamsDto,
    @Query() query: QueryUserDishReviewsDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<QueryUserDishReviewsResponse> {
    const result = await this.usersService.getUserDishReviews(
      params.id,
      query.cursor,
      user?.userId,
    );
    return this.usersMapper.toUserDishReviewsResponse(result);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/liked-dish-media                    */
  /* ------------------------------------------------------------------ */
  @Get('me/liked-dish-media')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分がいいねした料理投稿一覧' })
  @ApiQuery({ name: 'cursor', required: false, description: 'カーソル' })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeLikedDishMedia(
    @Query() query: QueryMeLikedDishMediaDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<QueryMeLikedDishMediaResponse> {
    const result = await this.usersService.getMeLikedDishMedia(
      user?.userId,
      query.cursor,
    );
    return this.usersMapper.toMeLikedDishMediaResponse(result);
  }

  /* ------------------------------------------------------------------ */
  /*                  GET /v1/users/me/payouts                         */
  /* ------------------------------------------------------------------ */
  @Get('me/payouts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分の収益一覧' })
  @ApiQuery({ name: 'cursor', required: false, description: 'カーソル' })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMePayouts(
    @Query() query: QueryMePayoutsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMePayoutsResponse> {
    const result = await this.usersService.getMePayouts(
      user.userId,
      query.cursor,
    );
    return this.usersMapper.toMePayoutsResponse(result);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/restaurant-bids                    */
  /* ------------------------------------------------------------------ */
  @Get('me/restaurant-bids')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分の入札履歴一覧' })
  @ApiQuery({ name: 'cursor', required: false, description: 'カーソル' })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeRestaurantBids(
    @Query() query: QueryMeRestaurantBidsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeRestaurantBidsResponse> {
    const result = await this.usersService.getMeRestaurantBids(
      user.userId,
      query.cursor,
    );
    return this.usersMapper.toMeRestaurantBidsResponse(result);
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/saved-dish-categories                */
  /* ------------------------------------------------------------------ */
  @Get('me/saved-dish-categories')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分の保存カテゴリ一覧' })
  @ApiQuery({ name: 'cursor', required: false, description: 'カーソル' })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeSavedDishCategories(
    @Query() query: QueryMeSavedDishCategoriesDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<QueryMeSavedDishCategoriesResponse> {
    const result = await this.usersService.getMeSavedDishCategories(
      user?.userId,
      query.cursor,
    );
    return this.usersMapper.toMeSavedDishCategoriesResponse(result);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/saved-dish-media                   */
  /* ------------------------------------------------------------------ */
  @Get('me/saved-dish-media')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '保存済み料理投稿一覧' })
  @ApiQuery({ name: 'cursor', required: false, description: 'カーソル' })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeSavedDishMedia(
    @Query() query: QueryMeSavedDishMediaDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<QueryMeSavedDishMediaResponse> {
    const result = await this.usersService.getMeSavedDishMedia(
      user?.userId,
      query.cursor,
    );
    return this.usersMapper.toMeSavedDishMediaResponse(result);
  }
}
