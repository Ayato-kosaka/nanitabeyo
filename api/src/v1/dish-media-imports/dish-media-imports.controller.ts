// api/src/v1/dish-media-imports/dish-media-imports.controller.ts
//
// #1399 `POST /v1/dish-media/imports/resolve`
//
// **既存の `DishMediaController` には足していない。** 既存コントローラは
// `@Post(':id/view')` のようにパスパラメータで受ける経路を持っており、そこへ
// 固定パスを足すと「どちらに当たるか」を読む手間が増える。独立した Controller にすれば
// ルーティングが一目で決まる。

import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ResolveDishMediaImportDto } from '@shared/v1/dto';
import { ResolveDishMediaImportResponse } from '@shared/v1/res';

import { AuthUserGuard } from '../../core/auth/auth.guard';
import { DishMediaImportsService } from './dish-media-imports.service';

@ApiTags('DishMedia')
@Controller('v1/dish-media/imports')
export class DishMediaImportsController {
  constructor(private readonly service: DishMediaImportsService) {}

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-media/imports/resolve  (要認証)            */
  /* ------------------------------------------------------------------ */
  @Post('resolve')
  @UseGuards(AuthUserGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      'SNS の URL を解決して店舗・料理カテゴリの候補を返す（読み取りのみ・保存しない）',
    description: [
      '**DB へ 1 行も書かない。** べき等で、ユーザーが確認画面で離脱してもゴミが残らない。',
      '対応外 URL・oEmbed 失敗・メタデータ空のいずれも 200 で «候補ゼロ＋理由» を返すので、',
      '呼び出し側は `status` / `reason` を見て手入力へ縮退すること。',
    ].join(' '),
  })
  @ApiResponse({
    status: 200,
    description:
      '解決結果。`status` が `unsupported` / `unknown` / `unavailable` でも 200 で返る',
  })
  @ApiResponse({
    status: 400,
    description: 'バリデーションエラー（url が空・4096 文字超など）',
  })
  async resolve(
    @Body() dto: ResolveDishMediaImportDto,
  ): Promise<ResolveDishMediaImportResponse> {
    return this.service.resolve(dto);
  }
}
