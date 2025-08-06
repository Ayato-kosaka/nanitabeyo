// api/src/v1/restaurants/restaurants.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❂ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ "認証必須 / 任意" を Guard で明確化
// ❹ Swagger / OpenAPI デコレータで自動ドキュメント化
//

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
  QueryRestaurantsDto,
  CreateRestaurantDto,
  CreateRestaurantBidIntentDto,
  QueryRestaurantDishMediaDto,
  QueryRestaurantBidsDto,
  RestaurantIdParamsDto,
} from '@shared/v1/dto';
import {
  QueryRestaurantsResponse,
  CreateRestaurantResponse,
  CreateRestaurantBidIntentResponse,
  QueryRestaurantDishMediaResponse,
  QueryRestaurantBidsResponse,
  GetRestaurantResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { RestaurantsService } from './restaurants.service';
import { RestaurantsMapper } from './restaurants.mapper';

@ApiTags('Restaurants')
@Controller('v1/restaurants')
export class RestaurantsController {
  constructor(
    private readonly restaurantsService: RestaurantsService,
    private readonly restaurantsMapper: RestaurantsMapper,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                       GET /v1/restaurants                          */
  /* ------------------------------------------------------------------ */
  @Get()
  @UseGuards(OptionalJwtAuthGuard) // ログインしていれば絞り込み強化、未ログインでも OK
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '座標周辺レストラン、入札状況一覧' })
  @ApiQuery({ name: 'lat', required: true, description: '緯度' })
  @ApiQuery({ name: 'lng', required: true, description: '経度' })
  @ApiQuery({ name: 'radius', required: true, description: '検索半径 (m)' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'ページネーション用カーソル',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async findRestaurants(
    @Query() query: QueryRestaurantsDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<{ data: QueryRestaurantsResponse; nextCursor?: string }> {
    const items = await this.restaurantsService.findRestaurantsNearby(
      query,
      user?.userId,
    );
    return this.restaurantsMapper.toQueryResponse(items);
  }

  /* ------------------------------------------------------------------ */
  /*                      POST /v1/restaurants                          */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Google Place ID でレストラン作成' })
  @ApiResponse({ status: 201, description: '作成成功' })
  async createRestaurant(
    @Body() dto: CreateRestaurantDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<CreateRestaurantResponse> {
    const result = await this.restaurantsService.createRestaurant(dto);
    return this.restaurantsMapper.toCreateResponse(result);
  }

  /* ------------------------------------------------------------------ */
  /*               POST /v1/restaurants/:id/bids/intents                */
  /* ------------------------------------------------------------------ */
  @Post(':id/bids/intents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: '入札意図の登録（決済前）' })
  @ApiParam({ name: 'id', required: true, description: 'レストランID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  async createBidIntent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRestaurantBidIntentDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateRestaurantBidIntentResponse> {
    const result = await this.restaurantsService.createBidIntent(
      id,
      dto,
      user.userId,
    );
    return this.restaurantsMapper.toBidIntentResponse(result.clientSecret);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/restaurants/:id/dish-media                   */
  /* ------------------------------------------------------------------ */
  @Get(':id/dish-media')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レストラン料理投稿一覧' })
  @ApiParam({ name: 'id', required: true, description: 'レストランID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'ページネーション用カーソル',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async findRestaurantDishMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryRestaurantDishMediaDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<{ data: QueryRestaurantDishMediaResponse; nextCursor?: string }> {
    const items = await this.restaurantsService.findRestaurantDishMedia(
      id,
      query,
      user?.userId,
    );
    return this.restaurantsMapper.toDishMediaResponse(items);
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/restaurants/:id/restaurant-bids                */
  /* ------------------------------------------------------------------ */
  @Get(':id/restaurant-bids')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レストラン入札履歴一覧' })
  @ApiParam({ name: 'id', required: true, description: 'レストランID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'ページネーション用カーソル',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async findRestaurantBids(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryRestaurantBidsDto,
  ): Promise<{ data: QueryRestaurantBidsResponse; nextCursor?: string }> {
    const items = await this.restaurantsService.findRestaurantBids(id, query);
    return this.restaurantsMapper.toRestaurantBidsResponse(items);
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/restaurants/:id                         */
  /* ------------------------------------------------------------------ */
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レストラン取得' })
  @ApiParam({ name: 'id', required: true, description: 'レストランID' })
  @ApiResponse({ status: 200, description: '取得成功' })
  async findRestaurant(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: RequestUser,
  ): Promise<GetRestaurantResponse> {
    const result = await this.restaurantsService.findRestaurantById(id);
    return this.restaurantsMapper.toGetResponse(result);
  }
}
