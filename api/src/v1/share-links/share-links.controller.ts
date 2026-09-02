// api/src/v1/share-links/share-links.controller.ts
//
// #721 【設計】共有リンクの作成と、アプリ用の resolve。
// SSR（`/s/:token`）は別 Controller（api/src/share/share.controller.ts）。

import { Body, Controller, Get, Param, Post, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateShareLinkDto } from '@shared/v1/dto';
import type { CreateShareLinkResponse, ResolveShareLinkResponse } from '@shared/v1/res';

import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { ShareLinksService } from './share-links.service';

@ApiTags('ShareLinks')
@Controller('v1/share-links')
export class ShareLinksController {
  constructor(private readonly service: ShareLinksService) {}

  /* ------------------------------------------------------------------ */
  /*                      POST /v1/share-links                          */
  /* ------------------------------------------------------------------ */

  /**
   * 共有リンクを作る。
   *
   * 匿名ユーザーからの作成も許す（共有はログイン前でも起こる導線にある）。
   * ただし作成者は記録する。
   */
  @Post()
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: '共有リンクの作成',
    description:
      '対象を検証し、共有時点の OGP スナップショットを固定して /s/<token> を返す。' +
      'title / image はサーバ側で生成する（クライアントから任意の値を保存させない）。',
  })
  @ApiResponse({ status: 201, description: '作成成功' })
  async create(
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateShareLinkResponse> {
    return this.service.create(dto, user?.id ?? null);
  }

  /* ------------------------------------------------------------------ */
  /*             GET /v1/share-links/:token/resolve                     */
  /* ------------------------------------------------------------------ */

  /**
   * アプリ用の resolve。
   *
   * 遷移先の path は返さない。サーバが返した文字列をそのまま `router.push` すると、
   * サーバ側の不備がそのままアプリ内の任意遷移になるため、アプリ側で
   * `target.type` を allowlist した Router へ変換させる。
   *
   * 認証は要求しない。共有リンクはログイン前のユーザーが最初に踏む導線であり、
   * ここで 401 にすると「アプリは開いたが何も出ない」になる。
   */
  @Get(':token/resolve')
  @ApiOperation({
    summary: '共有リンクの解決',
    description: 'token から target_type / target_id / params を返す。無効なら 404。',
  })
  @ApiParam({ name: 'token', required: true })
  @ApiResponse({ status: 200, description: '解決成功' })
  @ApiResponse({ status: 404, description: '存在しない / revoked / 期限切れ' })
  async resolve(@Param('token') token: string): Promise<ResolveShareLinkResponse> {
    return this.service.resolveForApp(token);
  }
}
