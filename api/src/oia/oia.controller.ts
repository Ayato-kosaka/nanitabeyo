// api/src/oia/oia.controller.ts
import { Controller, Get, Query, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { OiaService } from './oia.service';
import { AppLoggerService } from '../core/logger/logger.service';

/**
 * OIA (Open In App) Relay Controller
 *
 * iOS Universal Link 安定化のためのリダイレクトエンドポイント
 * - GET /oia/open?u=<encoded_target_url>
 * - 別オリジン（api.nanitabeyo.net）経由で外部起点に寄せる
 */
@Controller('oia')
export class OiaController {
  constructor(
    private readonly oiaService: OiaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * GET /oia/open
   *
   * クエリ u を受け取り、検証後に 302 Redirect
   * @param u リダイレクト先 URL（エンコード済み）
   * @param res Express Response オブジェクト
   */
  @Get('open')
  async openInApp(
    @Query('u') u: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // #713 【セキュリティ】URL 検証（protocol, host, 長さチェック）
    const validatedUrl = this.oiaService.validateTargetUrl(u);

    // #713 【設計】構造化ログ出力（成功率・抑止傾向追跡用）
    this.logger.log('oia_open_redirect', 'OiaController.openInApp', {
      targetHost: validatedUrl.host,
      targetPath: validatedUrl.pathname,
      userAgent: res.req.headers['user-agent'] ?? 'unknown',
      referer: res.req.headers['referer'] ?? null,
    });

    // #713 【仕様】302 Redirect（互換性優先）
    return res.redirect(HttpStatus.FOUND, validatedUrl.href);
  }
}
