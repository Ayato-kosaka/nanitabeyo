// api/src/v1/users/users.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❷ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ "認証必須 / 任意" を Guard で明確化
// ❹ Swagger / OpenAPI デコレータで自動ドキュメント化
//

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
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
  UpdateUserProfileDto,
  QueryUserDishReviewsDto,
  QueryMeLikedDishMediaDto,
  QueryMePayoutsDto,
  QueryMeRestaurantBidsDto,
  QueryMeSavedDishCategoriesDto,
  QueryMeSavedDishMediaDto,
} from '@shared/v1/dto';
import {
  GetUserProfileResponse,
  UpdateUserProfileResponse,
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
  /*                        GET /v1/users/:id                           */
  /* ------------------------------------------------------------------ */
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'ユーザープロフィール取得' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: '取得成功' })
  @ApiResponse({ status: 404, description: 'ユーザーが見つかりません' })
  async getUserProfile(
    @Param() params: UserIdParamsDto,
  ): Promise<GetUserProfileResponse> {
    const user = await this.usersService.getUserProfile(params.id);
    return this.usersMapper.toGetUserProfileResponse(user);
  }

  /* ------------------------------------------------------------------ */
  /*                        POST /v1/users/:id                          */
  /* ------------------------------------------------------------------ */
  @Post(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'ユーザープロフィール更新' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 403, description: '他のユーザーのプロフィールは更新できません' })
  @ApiResponse({ status: 404, description: 'ユーザーが見つかりません' })
  async updateUserProfile(
    @Param() params: UserIdParamsDto,
    @Body() dto: UpdateUserProfileDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UpdateUserProfileResponse> {
    const updatedUser = await this.usersService.updateUserProfile(
      params.id,
      user.id,
      dto,
    );
    return this.usersMapper.toUpdateUserProfileResponse(updatedUser);
  }

  /* ------------------------------------------------------------------ */
  /*                   GET /v1/users/:id/dish-reviews                  */
  /* ------------------------------------------------------------------ */
  @Get(':id/dish-reviews')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レビューした料理投稿一覧' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getUserDishReviews(
    @Param() params: UserIdParamsDto,
    @Query() query: QueryUserDishReviewsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QueryUserDishReviewsResponse> {
    const result = await this.usersService.getUserDishReviews(params.id, query);

    // Set CDN signed cookies if present (for video media)
    if (result.cdnCookies && result.cdnCookies.length > 0) {
      const existing = res.getHeader('Set-Cookie');
      const merged = [
        ...(existing
          ? Array.isArray(existing)
            ? existing
            : [String(existing)]
          : []),
        ...result.cdnCookies,
      ];
      res.setHeader('Set-Cookie', merged);
    }

    return this.usersMapper.toUserDishReviewsResponse(result);
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/liked-dish-media                  */
  /* ------------------------------------------------------------------ */
  @Get('me/liked-dish-media')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分がいいねした料理投稿一覧' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeLikedDishMedia(
    @Query() query: QueryMeLikedDishMediaDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QueryMeLikedDishMediaResponse> {
    const result = await this.usersService.getMeLikedDishMedia(
      user.id,
      user.isAnonymous,
      query,
    );

    // Set CDN signed cookies if present (for video media)
    if (result.cdnCookies && result.cdnCookies.length > 0) {
      const existing = res.getHeader('Set-Cookie');
      const merged = [
        ...(existing
          ? Array.isArray(existing)
            ? existing
            : [String(existing)]
          : []),
        ...result.cdnCookies,
      ];
      res.setHeader('Set-Cookie', merged);
    }

    return this.usersMapper.toMeLikedDishMediaResponse(result);
  }

  /* ------------------------------------------------------------------ */
  /*                     GET /v1/users/me/payouts                      */
  /* ------------------------------------------------------------------ */
  @Get('me/payouts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分の収益一覧' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMePayouts(
    @Query() query: QueryMePayoutsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMePayoutsResponse> {
    const items = await this.usersService.getMePayouts(user.id, query);
    return this.usersMapper.toMePayoutsResponse(items);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/restaurant-bids                    */
  /* ------------------------------------------------------------------ */
  @Get('me/restaurant-bids')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分の入札履歴一覧' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeRestaurantBids(
    @Query() query: QueryMeRestaurantBidsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeRestaurantBidsResponse> {
    const items = await this.usersService.getMeRestaurantBids(user.id, query);
    return this.usersMapper.toMeRestaurantBidsResponse(items);
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/saved-dish-categories                */
  /* ------------------------------------------------------------------ */
  @Get('me/saved-dish-categories')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分の保存カテゴリ一覧' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeSavedDishCategories(
    @Query() query: QueryMeSavedDishCategoriesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeSavedDishCategoriesResponse> {
    const items = await this.usersService.getMeSavedDishCategories(
      user.id,
      query,
    );
    return this.usersMapper.toMeSavedDishCategoriesResponse(items);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/saved-dish-media                   */
  /* ------------------------------------------------------------------ */
  @Get('me/saved-dish-media')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '保存済み料理投稿一覧' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeSavedDishMedia(
    @Query() query: QueryMeSavedDishMediaDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QueryMeSavedDishMediaResponse> {
    const result = await this.usersService.getMeSavedDishMedia(user.id, query);

    // Set CDN signed cookies if present (for video media)
    if (result.cdnCookies && result.cdnCookies.length > 0) {
      const existing = res.getHeader('Set-Cookie');
      const merged = [
        ...(existing
          ? Array.isArray(existing)
            ? existing
            : [String(existing)]
          : []),
        ...result.cdnCookies,
      ];
      res.setHeader('Set-Cookie', merged);
    }

    return this.usersMapper.toMeSavedDishMediaResponse(result);
  }
}
