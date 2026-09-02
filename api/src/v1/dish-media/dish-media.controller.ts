// api/src/modules/dish-media/dish-media.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❷ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ “認証必須 / 任意” を Guard で明確化
// ❹ Swagger / OpenAPI デコレータで自動ドキュメント化
//

import {
  Body,
  Controller,
  Delete,
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
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  CreateDishMediaDto,
  CreateDishMediaViewDto,
  QueryDishMediaByIdsDto,
  SearchDishMediaDto,
  DishMediaReactionBodyDto,
  DishMediaImpressionBodyDto,
} from '@shared/v1/dto';
import {
  SearchDishMediaResponse,
  CreateDishMediaResponse,
  CreateDishMediaViewResponse,
  DeleteDishMediaResponse,
  QueryDishMediaByIdsResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { AuthUserGuard, AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { DishMediaService } from './dish-media.service';

@ApiTags('DishMedia')
@Controller('v1/dish-media')
export class DishMediaController {
  constructor(private readonly dishMediaService: DishMediaService) {}

  /* ------------------------------------------------------------------ */
  /*                      GET /v1/dish-media?ids=...                     */
  /* ------------------------------------------------------------------ */
  @Get()
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'ID リストで料理メディア取得' })
  @ApiQuery({
    name: 'ids',
    required: true,
    description: 'dish media ids',
    isArray: true,
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async queryDishMediaByIds(
    @Query() query: QueryDishMediaByIdsDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QueryDishMediaByIdsResponse> {
    const result = await this.dishMediaService.findByIds(query.ids, user.id);

    return {
      items: result.items,
      notFound: result.notFound,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                      GET /v1/dish-media/search                      */
  /* ------------------------------------------------------------------ */
  @Get('search')
  @UseGuards(AuthAnonGuard) // ログインしていれば絞り込み強化、未ログインでも OK
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '条件検索で料理メディア取得（返却 1 件固定）' })
  @ApiQuery({
    name: 'location',
    required: true,
    description: '緯度経度 "lat,lng"',
  })
  @ApiQuery({ name: 'radius', required: true, description: '検索半径 (m)' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({
    name: 'preferredLanguageCodes',
    required: false,
    isArray: true,
    type: String,
    description:
      'レビュー表示で優先する元言語コード（優先度の高い順。端末言語→検索地点の言語）',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async searchDishMedia(
    @Query() query: SearchDishMediaDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SearchDishMediaResponse> {
    const result = await this.dishMediaService.findByCriteria(query, user.id);

    return result.items;
  }

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/dish-media  (要認証)                   */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: '料理メディア投稿（要ログイン）' })
  async createDishMedia(
    @Body() dto: CreateDishMediaDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDishMediaResponse> {
    return this.dishMediaService.createDishMedia(dto, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*              DELETE /v1/dish-media/:id (投稿の削除) #1513           */
  /* ------------------------------------------------------------------ */
  /**
   * #1513 自分の投稿を論理削除する。dish_media と、その投稿と一緒に作られた
   * レビューがまとめて消える。
   *
   * `:id/reaction` より **後ろ** に置かない。Nest はセグメント数が違う経路を
   * 取り違えないので順序は挙動に影響しないが、読む側が「reaction 削除の一種」と
   * 誤読しないよう本体の削除をここに置いている。
   */
  @Delete(':id')
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '投稿(dish_media)の削除（論理削除）' })
  @ApiParam({ name: 'id', required: true, description: 'dish_media.id' })
  @ApiResponse({ status: 200, description: '削除成功' })
  @ApiResponse({ status: 403, description: '自分の投稿ではない' })
  @ApiResponse({ status: 404, description: '存在しない' })
  async deleteDishMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DeleteDishMediaResponse> {
    return this.dishMediaService.deleteDishMedia(id, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*                  POST /v1/dish-media/:id/view                          */
  /* ------------------------------------------------------------------ */
  @Post(':id/view')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'DishMedia 視聴記録' })
  @ApiResponse({
    status: 200,
    description:
      '記録成功。ただし #1223 の残存タイミング障害（参照先 dish_media / impression が未登録）では 500 にせず `stored: false` / `id: null` / `analysis_applied: false` を返す。',
  })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 404, description: 'DishMedia が見つからない' })
  @ApiParam({ name: 'id', required: true })
  async createDishMediaView(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDishMediaViewDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDishMediaViewResponse> {
    return this.dishMediaService.createDishMediaView(id, dto, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dish-media/:id/reaction                      */
  /* ------------------------------------------------------------------ */
  @Post(':id/reaction')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'dish_media に Reaction を追加' })
  @ApiParam({ name: 'id', required: true, description: 'dish_media.id' })
  @ApiResponse({ status: 200, description: 'Reaction 追加成功' })
  async addReaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DishMediaReactionBodyDto,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.dishMediaService.addReaction(
      id,
      body.action_type,
      user.id,
      user.isAnonymous,
    );
  }

  /* ------------------------------------------------------------------ */
  /*              DELETE /v1/dish-media/:id/reaction                    */
  /* ------------------------------------------------------------------ */
  @Delete(':id/reaction')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'dish_media の Reaction を削除' })
  @ApiParam({ name: 'id', required: true, description: 'dish_media.id' })
  @ApiQuery({
    name: 'action_type',
    required: true,
    description: 'リアクション種別',
  })
  @ApiResponse({ status: 200, description: 'Reaction 削除成功' })
  async removeReaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DishMediaReactionBodyDto,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.dishMediaService.removeReaction(
      id,
      query.action_type,
      user.id,
      user.isAnonymous,
    );
  }

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dish-media/:id/impression                    */
  /* ------------------------------------------------------------------ */
  @Post(':id/impression')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'dish_media に Impression を記録' })
  @ApiParam({ name: 'id', required: true, description: 'dish_media.id' })
  @ApiResponse({ status: 200, description: 'Impression 記録成功' })
  async addImpression(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DishMediaImpressionBodyDto,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.dishMediaService.addImpression(id, user.id, body);
  }
}
