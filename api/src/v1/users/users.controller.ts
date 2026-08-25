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
  Delete,
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
  QuerySavedRestaurantsDto,
  QueryMeBlockedDishCategoriesDto,
  UnblockDishCategoryParamsDto,
  QueryMyDishesDto,
  QueryMeDishCategoryGroupVotesDto,
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
  QueryMeSavedRestaurantsResponse,
  QueryMeBlockedDishCategoriesResponse,
  UnblockDishCategoryResponse,
  QueryMyDishesResponse,
  QueryMeDishMapPinsResponse,
  QueryMeDishCategoryGroupVotesResponse,
  DeleteMeResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { AuthUserGuard, AuthAnonGuard } from '../../core/auth/auth.guard';
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
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'ユーザープロフィール取得' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: '取得成功' })
  @ApiResponse({ status: 404, description: 'ユーザーが見つかりません' })
  async getUserProfile(
    @Param() params: UserIdParamsDto,
  ): Promise<GetUserProfileResponse> {
    return await this.usersService.getUserProfile(params.id);
  }

  /* ------------------------------------------------------------------ */
  /*                        POST /v1/users/me                           */
  /* ------------------------------------------------------------------ */
  @Post('/me')
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'ユーザープロフィール更新' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({
    status: 403,
    description: '他のユーザーのプロフィールは更新できません',
  })
  @ApiResponse({ status: 404, description: 'ユーザーが見つかりません' })
  async updateUserProfile(
    @Body() dto: UpdateUserProfileDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UpdateUserProfileResponse> {
    return await this.usersService.updateUserProfile(user.id, dto);
  }

  /* ------------------------------------------------------------------ */
  /*                       DELETE /v1/users/me                          */
  /* ------------------------------------------------------------------ */
  /**
   * #1511 ACC-01 アカウント削除。
   *
   * ⚠️ **`AuthUserGuard`（= 正規ログインのみ）。** ゲスト（匿名）ユーザーには
   * そもそも `users` 行が無く、削除対象となる実体を持たない。ストア審査が求める
   * 「アカウントを作成できるアプリは削除手段を提供する」も正規アカウントへの要求である。
   *
   * ⚠️ **取り消せない。** アプリ DB 側は匿名化（論理削除）だが、Supabase Auth の
   * アカウントは物理削除するため、同じ資格情報での再ログイン経路は残らない。
   * クライアントは実行前に必ず確認ダイアログでその旨を明示すること。
   *
   * 冪等: 途中で失敗した削除は、同じリクエストの再送で最後まで完了できる。
   */
  @Delete('/me')
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'アカウント削除（取り消し不可・#1511）',
    description:
      'users 行は残したまま PII を匿名化して deleted_at を立て、本人の行動データとストレージ実体を削除し、Supabase Auth のアカウントを物理削除する。',
  })
  @ApiResponse({ status: 200, description: '削除成功' })
  @ApiResponse({ status: 403, description: 'ゲストユーザーは削除できません' })
  @ApiResponse({ status: 404, description: 'ユーザーが見つかりません' })
  @ApiResponse({
    status: 503,
    description:
      '認証アカウントの削除に失敗（再送で完了できる。アプリ DB 側の匿名化は完了している）',
  })
  async deleteMe(@CurrentUser() user: RequestUser): Promise<DeleteMeResponse> {
    return await this.usersService.deleteMe(user.id);
  }

  /* ------------------------------------------------------------------ */
  /*                   GET /v1/users/:id/dish-reviews                  */
  /* ------------------------------------------------------------------ */
  @Get(':id/dish-reviews')
  @UseGuards(AuthAnonGuard)
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
    const { data, nextCursor } = await this.usersService.getUserDishReviews(
      params.id,
      query,
    );

    return { data, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/users/me/liked-dish-media                  */
  /* ------------------------------------------------------------------ */
  @Get('me/liked-dish-media')
  @UseGuards(AuthAnonGuard)
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
    const { data, nextCursor } = await this.usersService.getMeLikedDishMedia(
      user.id,
      user.isAnonymous,
      query,
    );

    return { data, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*                     GET /v1/users/me/payouts                      */
  /* ------------------------------------------------------------------ */
  @Get('me/payouts')
  @UseGuards(AuthUserGuard)
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
  @UseGuards(AuthUserGuard)
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
  @UseGuards(AuthAnonGuard)
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
  @UseGuards(AuthAnonGuard)
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
    const { data, nextCursor } = await this.usersService.getMeSavedDishMedia(
      user.id,
      query,
    );

    return { data, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*          GET /v1/users/me/dish-category-group-votes               */
  /* ------------------------------------------------------------------ */
  @Get('me/dish-category-group-votes')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: '自分が主催した dish_category グループ投票一覧',
    description:
      'host_user_id が自分のセッションだけを返す(参加しただけのセッションは含まない)。hasVoted は主催者自身が投票済みかを表す。',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeDishCategoryGroupVotes(
    @Query() query: QueryMeDishCategoryGroupVotesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeDishCategoryGroupVotesResponse> {
    const { data, nextCursor } =
      await this.usersService.getMeDishCategoryGroupVotes(user.id, query);

    return { data, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/users/me/saved-restaurants                    */
  /* ------------------------------------------------------------------ */
  // #644 【設計】保存したお店を位置情報で検索
  @Get('me/saved-restaurants')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '保存済みレストラン一覧（位置情報付き）' })
  @ApiQuery({ name: 'lat', required: true, description: 'Latitude' })
  @ApiQuery({ name: 'lng', required: true, description: 'Longitude' })
  @ApiQuery({ name: 'radius', required: true, description: 'Radius in meters' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Limit (default: 20)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Offset (default: 0)',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeSavedRestaurants(
    @Query() query: QuerySavedRestaurantsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeSavedRestaurantsResponse> {
    const { data, nextCursor } =
      await this.usersService.getMySavedNearbyRestaurants(user.id, query);

    return { data, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/users/me/dishes                        */
  /* ------------------------------------------------------------------ */
  // #1395 「食べたい/食べた」の一覧。リストと Calendar が同じクエリ契約を共有する
  //
  // Guard は AuthAnonGuard。既存の me/* と同じで、匿名セッションのユーザーにも
  // 実 user.id があるためゲストでも動く（AuthUserGuard にするとゲストが 401 になる）
  @Get('me/dishes')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '自分の「食べたい/食べた」一覧' })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'want / eaten（multi・CSV可）。未指定は両方',
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    description: 'エリア中心の緯度。lat/lng/radius は 3 点セット',
  })
  @ApiQuery({ name: 'lng', required: false, description: 'エリア中心の経度' })
  @ApiQuery({ name: 'radius', required: false, description: 'エリア半径（m）' })
  @ApiQuery({
    name: 'categoryIds',
    required: false,
    description: '料理カテゴリ（multi・CSV可）',
  })
  @ApiQuery({ name: 'minRating', required: false, description: '★n 以上' })
  @ApiQuery({
    name: 'ratings',
    required: false,
    description: '★n のみ（multi・CSV可）',
  })
  @ApiQuery({ name: 'from', required: false, description: 'occurredAt の下限' })
  @ApiQuery({ name: 'to', required: false, description: 'occurredAt の上限' })
  @ApiQuery({
    name: 'sort',
    required: false,
    description:
      '-occurredAt(既定) / occurredAt / -rating / distance / -featureScore',
  })
  @ApiQuery({
    name: 'featureKeys',
    required: false,
    description:
      'sort=-featureScore のときの軸。"<feature_type>:<feature_key>" の CSV。' +
      '例: timeSlot:dinner,scene:friends,dining_pace:quick（複数指定はスコアの合計順）',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'keyset カーソル',
  })
  @ApiQuery({ name: 'limit', required: false, description: '既定 42' })
  @ApiResponse({ status: 200, description: '取得成功' })
  @ApiResponse({ status: 400, description: 'クエリ不正（カーソル / エリア）' })
  async getMyDishes(
    @Query() query: QueryMyDishesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMyDishesResponse> {
    return await this.usersService.getMyDishes(user.id, query);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/users/me/dishes/map-pins                    */
  /* ------------------------------------------------------------------ */
  // #1395 Map ビュー。一覧と同じ QueryMyDishesDto を取り、店舗単位に集約して返す
  @Get('me/dishes/map-pins')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: '自分の「食べたい/食べた」の店舗ピン（同一店舗につき 1 つ）',
  })
  @ApiResponse({
    status: 200,
    description: '取得成功。上限で切られた場合は truncated: true',
  })
  async getMyDishMapPins(
    @Query() query: QueryMyDishesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeDishMapPinsResponse> {
    return await this.usersService.getMyDishMapPins(user.id, query);
  }

  /* ------------------------------------------------------------------ */
  /*          GET /v1/users/me/blocked-dish-categories                 */
  /* ------------------------------------------------------------------ */
  @Get('me/blocked-dish-categories')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'ブロック中の料理カテゴリ一覧' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async getMeBlockedDishCategories(
    @Query() query: QueryMeBlockedDishCategoriesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeBlockedDishCategoriesResponse> {
    const items = await this.usersService.getMeBlockedDishCategories(
      user.id,
      query,
    );
    return this.usersMapper.toMeBlockedDishCategoriesResponse(items);
  }

  /* ------------------------------------------------------------------ */
  /*     DELETE /v1/users/me/blocked-dish-categories/:categoryId       */
  /* ------------------------------------------------------------------ */
  @Delete('me/blocked-dish-categories/:categoryId')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '料理カテゴリのブロック解除' })
  @ApiParam({ name: 'categoryId', description: 'Dish Category ID' })
  @ApiResponse({ status: 200, description: '解除成功' })
  async unblockDishCategory(
    @Param() params: UnblockDishCategoryParamsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UnblockDishCategoryResponse> {
    return await this.usersService.unblockDishCategory(
      user.id,
      params.categoryId,
    );
  }
}
