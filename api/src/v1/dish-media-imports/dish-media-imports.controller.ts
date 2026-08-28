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

import {
  CreateDishMediaImportDto,
  ResolveDishMediaImportDto,
} from '@shared/v1/dto';
import {
  CreateDishMediaImportResponse,
  ResolveDishMediaImportResponse,
} from '@shared/v1/res';

import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import type { RequestUser } from '../../core/auth/auth.types';
import { DishMediaImportsService } from './dish-media-imports.service';

@ApiTags('DishMedia')
@Controller('v1/dish-media/imports')
export class DishMediaImportsController {
  constructor(private readonly service: DishMediaImportsService) {}

  /* ------------------------------------------------------------------ */
  /*            POST /v1/dish-media/imports/resolve  (要認証)            */
  /* ------------------------------------------------------------------ */
  // #1375 実機確認: **ログイン必須にしない**（`AuthUserGuard` は匿名を 403 で弾く）。
  // 取り込んだ dish_media の投稿者はアプリのユーザーではないので `user_id` は NULL のままで、
  // ユーザーとの紐付けは `reactions(save)` が持つ。匿名ユーザーも実 user id を持っており
  // save は書けるので、取り込み自体にフルログインを要求する理由が無い
  @Post('resolve')
  @UseGuards(AuthAnonGuard)
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

  /* ------------------------------------------------------------------ */
  /*        POST /v1/dish-media/imports  (匿名可・保存する)             */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'SNS の URL から取り込んだ 1 件を保存し、「食べたい」に入れる',
    description: [
      '`resolve` と違い **DB へ書く**。URL はここでもう一度サーバ側で解決し直すので、',
      'クライアントが送る provider / externalContentId は受け取らない。',
      '同じ SNS 投稿を同じ料理へ二重に取り込むことはなく（自然キーの UNIQUE）、',
      '既に在る場合はその dish_media を指したうえで `reactions(save)` だけを用意する。',
    ].join(' '),
  })
  @ApiResponse({ status: 201, description: '保存した（または既に在った）1 件' })
  @ApiResponse({
    status: 400,
    description:
      '対応外の URL（IMPORT_UNSUPPORTED:*）/ 相手が消えている（IMPORT_UNAVAILABLE:*）',
  })
  async create(
    @Body() dto: CreateDishMediaImportDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDishMediaImportResponse> {
    return this.service.create(dto, user.id);
  }
}
