// api/src/v1/restaurants/restaurants.controller.ts
//
// ❶ Controller for restaurants endpoints
// ❷ Following the pattern from dish-media/dish-media.controller.ts
// ❸ Handles 4 endpoints: search, create, dish-media, by-google-place-id

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  QueryRestaurantsDto,
  CreateRestaurantDto,
  QueryRestaurantDishMediaDto,
  QueryRestaurantsByGooglePlaceIdDto,
  RestaurantIdParamsDto,
} from '@shared/v1/dto';
import {
  QueryRestaurantsResponse,
  CreateRestaurantResponse,
  QueryRestaurantDishMediaResponse,
  QueryRestaurantsByGooglePlaceIdResponse,
  GetRestaurantByIdResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { RestaurantsService } from './restaurants.service';

@ApiTags('Restaurants')
@Controller('v1/restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  /* ------------------------------------------------------------------ */
  /*                  GET /v1/restaurants/search                        */
  /* ------------------------------------------------------------------ */
  @Get('search')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '座標周辺レストラン・入札状況一覧' })
  @ApiQuery({ name: 'lat', description: '緯度', type: 'number' })
  @ApiQuery({ name: 'lng', description: '経度', type: 'number' })
  @ApiQuery({ name: 'radius', description: '半径（メートル）', type: 'number' })
  @ApiQuery({
    name: 'q',
    required: false,
    description:
      '#1395 店名の部分一致（自前 restaurants テーブル。Google Places は呼ばない）。指定時は距離順になる',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'ページネーション用カーソル',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async searchRestaurants(
    @Query() query: QueryRestaurantsDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<QueryRestaurantsResponse> {
    // 座標周辺のレストラン検索と入札状況を取得
    return this.restaurantsService.searchRestaurants(query);
  }

  /* ------------------------------------------------------------------ */
  /*                     POST /v1/restaurants                           */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Google Place ID でレストラン作成' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 404, description: 'Google Place が見つからない' })
  async createRestaurant(
    @Body() dto: CreateRestaurantDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<CreateRestaurantResponse> {
    // Google Place Details API からレストラン情報を取得して作成
    return this.restaurantsService.createRestaurant(dto);
  }

  /* ------------------------------------------------------------------ */
  /*            GET /v1/restaurants/by-google-place-id                  */
  /* ------------------------------------------------------------------ */
  @Get('by-google-place-id')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Google Place ID でレストラン取得' })
  @ApiQuery({
    name: 'googlePlaceId',
    description: 'Google Place ID',
    type: 'string',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  @ApiResponse({ status: 404, description: 'レストランが見つからない' })
  async getRestaurantByGooglePlaceId(
    @Query() query: QueryRestaurantsByGooglePlaceIdDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<QueryRestaurantsByGooglePlaceIdResponse | null> {
    // Google Place ID でレストランを検索
    return this.restaurantsService.getRestaurantByGooglePlaceId(query);
  }

  /* ------------------------------------------------------------------ */
  /*                    GET /v1/restaurants/:id                         */
  /* ------------------------------------------------------------------ */
  @Get(':id')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レストランID でレストラン取得' })
  @ApiParam({ name: 'id', description: 'Restaurant ID' })
  @ApiResponse({ status: 200, description: '取得成功' })
  @ApiResponse({ status: 404, description: 'レストランが見つからない' })
  async getRestaurantById(
    @Param() params: RestaurantIdParamsDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<GetRestaurantByIdResponse> {
    // #644 【設計】restaurant.id でレストラン詳細と統計情報を取得
    return this.restaurantsService.getRestaurantById(params.id);
  }

  /* ------------------------------------------------------------------ */
  /*               GET /v1/restaurants/:id/dish-media                   */
  /* ------------------------------------------------------------------ */
  @Get(':id/dish-media')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'レストラン料理投稿一覧' })
  @ApiParam({ name: 'id', description: 'Restaurant ID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'ページネーション用カーソル',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  @ApiResponse({ status: 404, description: 'レストランが見つからない' })
  async getRestaurantDishMedia(
    @Param() params: RestaurantIdParamsDto,
    @Query() query: QueryRestaurantDishMediaDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QueryRestaurantDishMediaResponse> {
    // レストランの料理投稿一覧を取得
    return await this.restaurantsService.getRestaurantDishMedia(
      params.id,
      query,
      user.id,
    );
  }
}
