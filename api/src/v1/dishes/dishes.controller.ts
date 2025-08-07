// api/src/v1/dishes/dishes.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❷ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ "認証必須 / 任意" を Guard で明確化
// ❹ Swagger / OpenAPI デコレータで自動ドキュメント化
//

import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateDishDto, BulkImportDishesDto } from '@shared/v1/dto';
import { CreateDishResponse, BulkImportDishesResponse } from '@shared/v1/res';

// 横串 (Auth)
import { OptionalJwtAuthGuard } from '../../core/auth/auth.guard';

// ドメイン Service
import { DishesService } from './dishes.service';

@ApiTags('Dishes')
@Controller('v1/dishes')
export class DishesController {
  constructor(private readonly dishesService: DishesService) {}

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/dishes (任意認証)                      */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: '料理マスター作成 or 取得' })
  @ApiResponse({ status: 201, description: '料理作成/取得成功' })
  async createDish(@Body() dto: CreateDishDto): Promise<CreateDishResponse> {
    return this.dishesService.createOrGetDish(dto);
  }

  /* ------------------------------------------------------------------ */
  /*                POST /v1/dishes/bulk-import (任意認証)               */
  /* ------------------------------------------------------------------ */
  @Post('bulk-import')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Google一括料理登録' })
  @ApiResponse({ status: 201, description: '一括登録成功' })
  async bulkImportDishes(
    @Body() dto: BulkImportDishesDto,
  ): Promise<BulkImportDishesResponse> {
    return this.dishesService.bulkImportFromGoogle(dto);
  }
}
