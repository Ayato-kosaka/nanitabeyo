// api/src/v1/content-reports/me-content-reports.controller.ts
//
// #1584 【設計】自分が出した通報の履歴。
//
// パスを `v1/users/me/...` に置くのは、他の «自分のもの» の一覧
// （me/liked-dish-media, me/saved-dish-categories 等）と同じ棚に並べるため。
// ただし実装は通報モジュールに置く。UsersController から
// ContentReportsService を触らせると、通報の読み出し規則が 2 つのモジュールへ散る。

import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { QueryMeContentReportsDto } from '@shared/v1/dto';
import type { QueryMeContentReportsResponse } from '@shared/v1/res';

import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { ContentReportsService } from './content-reports.service';

@ApiTags('ContentReports')
@Controller('v1/users/me/content-reports')
export class MeContentReportsController {
  constructor(private readonly service: ContentReportsService) {}

  /**
   * 自分が出した通報の履歴を返す。
   *
   * ## 返すのは «いつ・どの理由で出したか» だけ
   * 審査状況は返さない（オーナー確定仕様 #1584）。理由は Service の JSDoc にある。
   *
   * ## 他人の通報は原理的に読めない
   * 絞り込みキーは `@CurrentUser()` の id のみで、**クエリから通報者を指定する口を作っていない**。
   * 「対象 ID で引く」口も作らない。作ると «この投稿は通報されているか» を
   * 誰でも観測できてしまい、#1514 が守っている «通報は相手に見えない» が崩れる。
   *
   * 匿名ユーザーも通報できる（#1514）ので、履歴も `AuthAnonGuard` で受ける。
   * 匿名の uid は端末のサインインに紐づくので、その端末で出した通報だけが並ぶ。
   */
  @Get()
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: '自分が出した通報の履歴',
    description:
      '受付日と理由コードだけを新しい順で返す。審査状況（status）は返さない。',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: '取得開始位置（created_at の ISO 文字列）',
  })
  @ApiResponse({ status: 200, description: '取得成功' })
  async findMine(
    @Query() query: QueryMeContentReportsDto,
    @CurrentUser() user: RequestUser,
  ): Promise<QueryMeContentReportsResponse> {
    return this.service.findMine(user.id, query);
  }
}
