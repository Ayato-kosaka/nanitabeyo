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
  LikeDishMediaParamsDto,
  SaveDishMediaParamsDto,
  QueryDishMediaByIdsDto,
  SearchDishMediaDto,
} from '@shared/v1/dto';
import {
  SearchDishMediaResponse,
  CreateDishMediaResponse,
  CreateDishMediaViewResponse,
  LikeDishMediaResponse,
  UnlikeDishMediaResponse,
  SaveDishMediaResponse,
  QueryDishMediaByIdsResponse,
} from '@shared/v1/res';

// 横串 (Auth)
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { DishMediaService } from './dish-media.service';
import { DishMediaMapper } from './dish-media.mapper';

@ApiTags('DishMedia')
@Controller('v1/dish-media')
export class DishMediaController {
  constructor(
    private readonly dishMediaService: DishMediaService,
    private readonly dishMediaMapper: DishMediaMapper,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                      GET /v1/dish-media?ids=...                     */
  /* ------------------------------------------------------------------ */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
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
    const result = await this.dishMediaService.findByIds(query.ids, user?.id);

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

    return {
      items: this.dishMediaMapper.toSearchDishMediaResponse(result.items),
      notFound: result.notFound,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                      GET /v1/dish-media/search                      */
  /* ------------------------------------------------------------------ */
  @Get('search')
  @UseGuards(OptionalJwtAuthGuard) // ログインしていれば絞り込み強化、未ログインでも OK
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '条件検索で料理メディア取得（返却 1 件固定）' })
  @ApiQuery({
    name: 'location',
    required: true,
    description: '緯度経度 "lat,lng"',
  })
  @ApiQuery({ name: 'radius', required: true, description: '検索半径 (m)' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiResponse({ status: 200, description: '取得成功' })
  async searchDishMedia(
    @Query() query: SearchDishMediaDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SearchDishMediaResponse> {
    const result = await this.dishMediaService.findByCriteria(query, user?.id);

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

    return this.dishMediaMapper.toSearchDishMediaResponse(result.items);
  }

  /* ------------------------------------------------------------------ */
  /*                POST /v1/dish-media/:id/likes                       */
  /* ------------------------------------------------------------------ */
  @Post(':id/likes')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '料理メディアにいいね' })
  @ApiParam({ name: 'id', required: true })
  async likeDishMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<LikeDishMediaResponse> {
    const params: LikeDishMediaParamsDto = { id };
    return this.dishMediaService.likeDishMedia(params, user.id);
  }

  /* -------------------- DELETE /v1/dish-media/:id/likes ------------------- */
  @Delete(':id/likes')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '料理メディアのいいね解除' })
  @ApiParam({ name: 'id', required: true })
  async unlikeDishMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<UnlikeDishMediaResponse> {
    const params: LikeDishMediaParamsDto = { id };
    return this.dishMediaService.unlikeDishMedia(params, user.id);
  }

  /* -------------------- POST /v1/dish-media/:id/save ---------------------- */
  @Post(':id/save')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: '料理メディアを保存' })
  @ApiParam({ name: 'id', required: true })
  async saveDishMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<SaveDishMediaResponse> {
    const params: SaveDishMediaParamsDto = { id };
    return this.dishMediaService.saveDishMedia(params, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/dish-media  (要認証)                   */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(JwtAuthGuard)
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
  /*                  POST /v1/dish-media/view                          */
  /* ------------------------------------------------------------------ */
  @Post('view')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'DishMedia 視聴記録' })
  @ApiResponse({ status: 200, description: '記録成功' })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 404, description: 'DishMedia が見つからない' })
  async createDishMediaView(
    @Body() dto: CreateDishMediaViewDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDishMediaViewResponse> {
    // If user is authenticated, use their ID; otherwise use the one from DTO (if any)
    const userId = user?.id || dto.user_id;

    return this.dishMediaService.createDishMediaView({
      ...dto,
      user_id: userId,
    });
  }
}
