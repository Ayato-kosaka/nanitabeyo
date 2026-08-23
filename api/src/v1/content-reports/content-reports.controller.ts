// api/src/v1/content-reports/content-reports.controller.ts
//
// #1514 (SAF-01) 【設計】投稿・レビューの通報の受付エンドポイント。

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

import { CreateContentReportDto } from '@shared/v1/dto';
import type { CreateContentReportResponse } from '@shared/v1/res';

import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { ContentReportsService } from './content-reports.service';

@ApiTags('ContentReports')
@Controller('v1/content-reports')
export class ContentReportsController {
  constructor(private readonly service: ContentReportsService) {}

  /* ------------------------------------------------------------------ */
  /*                    POST /v1/content-reports                        */
  /* ------------------------------------------------------------------ */

  /**
   * 投稿（`dish_media`）またはレビュー（`dish_reviews`）を通報する。
   *
   * 対象種別ごとにエンドポイントを分けない。受付・重複・レスポンスの規則が同じなので、
   * 分けると同じ仕様を 2 箇所で保守することになる（`target_type` は body で受ける）。
   *
   * 匿名ユーザーからの通報も受け付ける（`AuthAnonGuard`）。通報の敷居を上げると、
   * 一番通報したい人（アカウントを作っていない閲覧者）が通報できなくなる。
   * ただし通報者は必ず記録する。JWT が無ければ 401 になり、`user.id` は常に埋まる。
   *
   * 一覧・取得の GET は作らない。自分の通報も含めて読み出す導線を作らないのが
   * 「自分の通報が他のユーザーから見えない」の最も単純な担保になる
   * （テーブルの RLS もポリシー無しで、クライアントからは 1 行も読めない）。
   */
  @Post()
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: '投稿・レビューの通報',
    description:
      '対象（dish_media / dish_reviews）の実在を検証して通報を保存し、受付番号（reportId）を返す。' +
      '同一ユーザー × 同一対象の 2 回目以降は新規作成せず既存の受付番号を返す（冪等）。' +
      '通報しても対象は即時非表示にならない。',
  })
  @ApiResponse({
    status: 201,
    description: '受付成功（重複時も 201 で既存の受付番号を返す）',
  })
  @ApiResponse({
    status: 400,
    description: '対象種別・理由コードが未知、または自由記述が長すぎる',
  })
  @ApiResponse({
    status: 404,
    description: '通報対象（投稿・レビュー）が存在しない',
  })
  async create(
    @Body() dto: CreateContentReportDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateContentReportResponse> {
    return this.service.create(dto, user.id);
  }
}
