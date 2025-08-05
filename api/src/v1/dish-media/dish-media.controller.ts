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
    CreateDishMediaDto,
    LikeDishMediaParamsDto,
    SaveDishMediaParamsDto,
    QueryDishMediaDto,
} from '@shared/v1/dto';

// 横串 (Auth)
import {
    JwtAuthGuard,
    OptionalJwtAuthGuard,
} from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';

// ドメイン Service
import { DishMediaService } from './dish-media.service';

@ApiTags('DishMedia')
@Controller('v1/dish-media')
export class DishMediaController {
    constructor(private readonly dishMediaService: DishMediaService) { }

    /* ------------------------------------------------------------------ */
    /*                             GET /v1/dish-media                     */
    /* ------------------------------------------------------------------ */
    @Get()
    @UseGuards(OptionalJwtAuthGuard) // ログインしていれば絞り込み強化、未ログインでも OK
    @UsePipes(new ValidationPipe({ transform: true }))
    @ApiOperation({ summary: '条件検索で料理メディア取得（返却 1 件固定）' })
    @ApiQuery({ name: 'location', required: true, description: '緯度経度 "lat,lng"' })
    @ApiQuery({ name: 'radius', required: true, description: '検索半径 (m)' })
    @ApiQuery({ name: 'categoryId', required: false })
    @ApiResponse({ status: 200, description: '取得成功' })
    async findByQuery(
        @Query() query: QueryDishMediaDto,
        @CurrentUser() user?: RequestUser,
    ) {
        return this.dishMediaService.findByCriteria(query, user?.userId);
    }

    /* ------------------------------------------------------------------ */
    /*                POST /v1/dish-media/:id/likes/:userId               */
    /* ------------------------------------------------------------------ */
    @Post(':id/likes/:userId')
    @UsePipes(new ValidationPipe({ transform: true }))
    @ApiOperation({ summary: '料理メディアにいいね' })
    @ApiParam({ name: 'id', required: true })
    @ApiParam({ name: 'userId', required: true })
    async likeDishMedia(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('userId', ParseUUIDPipe) userId: string,
    ) {
        const params: LikeDishMediaParamsDto = { id, userId };
        return this.dishMediaService.likeDishMedia(params);
    }

    /* -------------------- DELETE /v1/dish-media/:id/likes/:userId ------------------- */
    @Delete(':id/likes/:userId')
    @UsePipes(new ValidationPipe({ transform: true }))
    @ApiOperation({ summary: '料理メディアのいいね解除' })
    @ApiParam({ name: 'id', required: true })
    @ApiParam({ name: 'userId', required: true })
    async unlikeDishMedia(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('userId', ParseUUIDPipe) userId: string,
    ) {
        const params: LikeDishMediaParamsDto = { id, userId };
        return this.dishMediaService.unlikeDishMedia(params);
    }

    /* -------------------- POST /v1/dish-media/:id/save/:userId ---------------------- */
    @Post(':id/save/:userId')
    @UsePipes(new ValidationPipe({ transform: true }))
    @ApiOperation({ summary: '料理メディアを保存' })
    @ApiParam({ name: 'id', required: true })
    @ApiParam({ name: 'userId', required: true })
    async saveDishMedia(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('userId', ParseUUIDPipe) userId: string,
    ) {
        const params: SaveDishMediaParamsDto = { id, userId };
        return this.dishMediaService.saveDishMedia(params);
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
    ) {
        return this.dishMediaService.createDishMedia(dto, user.userId);
    }
}
