// api/src/v1/restaurant-reports/restaurant-reports.controller.ts
//
// #1933 【設計】店舗情報の «この情報が違う» 報告の受付エンドポイント。

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

import { CreateRestaurantReportDto } from '@shared/v1/dto';
import type { CreateRestaurantReportResponse } from '@shared/v1/res';

import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { RestaurantReportsService } from './restaurant-reports.service';

@ApiTags('RestaurantReports')
@Controller('v1/restaurant-reports')
export class RestaurantReportsController {
  constructor(private readonly service: RestaurantReportsService) {}

  /* ------------------------------------------------------------------ */
  /*                  POST /v1/restaurant-reports                       */
  /* ------------------------------------------------------------------ */

  /**
   * 店舗情報の «この情報が違う» を報告する。
   *
   * ## 通報（`POST /v1/content-reports`）に相乗りさせない
   * 2026-09-23 オーナー判断「テーブルが違うなら分けるべき」。通報は «消すかどうか»、
   * 報告は «値を直すかどうか» で、持つ列（どの項目の・どんな値へ）も運用も違う。
   *
   * ## 匿名ユーザーからの報告も受け付ける（`AuthAnonGuard`）
   * いちばん報告したいのは «行ってみたら閉店していた» 人で、その場でアカウントを
   * 作らせると報告は来ない。ただし報告者は必ず記録する（JWT が無ければ 401 になり、
   * `user.id` は常に埋まる）。受け入れ条件 10 の二重報告の判定もこの uid で行う。
   *
   * ## 読み出しの GET を作らない
   * 作ると «この店は報告されているか» を誰でも観測できてしまう。報告の中身
   * （`proposed_value`）は第三者の個人情報を含みうるので、なおさら外へ出さない。
   * オーナーは Issue と DB で見る（受け入れ条件 7〜9）。
   * テーブルの RLS はポリシー無しのまま（クライアントから直接は 1 行も読めない）。
   */
  @Post()
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: '店舗情報の «この情報が違う» 報告',
    description:
      '店の実在を検証して報告を保存し、受付番号（reportId）を返す。' +
      '同一ユーザー × 同一店 × 同一項目の 2 回目以降は新規作成せず既存の受付番号を返す（冪等）。' +
      '報告しても店の情報はその場では変わらない。',
  })
  @ApiResponse({
    status: 201,
    description: '受付成功（二重報告時も 201 で既存の受付番号を返す）',
  })
  @ApiResponse({
    status: 400,
    description:
      '報告項目が未知、値が長すぎる、または値が要る項目で «正しい値» が空',
  })
  @ApiResponse({ status: 404, description: '報告対象の店が存在しない' })
  async create(
    @Body() dto: CreateRestaurantReportDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateRestaurantReportResponse> {
    return this.service.create(dto, user.id);
  }
}
