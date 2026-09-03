// api/src/v1/maps/maps.controller.ts
//
// #843 【設計】Google Places の呼び出し上限に当たったときのフォールバックを、
// 消費者向け Google Maps アプリへ飛ばすのではなく «アプリ内の地図» へ変えるための入口。
//
// - `https://www.google.com/maps/...`（消費者向け）は `x-frame-options: SAMEORIGIN` で
//   埋め込めない。埋め込めるのは Maps Embed API（`/maps/embed/v1/...`）だけ
// - Maps Embed API は無料・上限なしの SKU なので、Places の呼び出し回数を増やさずに使える
// - API キーはこの HTML の iframe src にしか入れない。クライアント（app-expo）には焼かない
//
// #1810 PL レビュー 2番【設計】GET /v1/maps/embed に認証ガードが無い問題への対応。
// WebView / iframe は URL を «文書として» 読むので Authorization ヘッダを付けられない。
// 素直に @UseGuards を付けると動かないため、代わりに次の 2 段構成にする。
//
// 1. POST /v1/maps/embed-token（@UseGuards(AuthAnonGuard) 付き）が mode/q/center/zoom/hl を
//    受け取り、検証したうえで短命の署名付きトークンを返す
// 2. GET /v1/maps/embed（ガード無し）はそのトークンだけを受け取り、署名と有効期限を検証する
//
// 「トークンを持っていること」自体が、直前に認証済みリクエストで発行を受けたことの証明になる。

import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CreateMapsEmbedTokenDto, QueryMapsEmbedDto } from '@shared/v1/dto';
import type { CreateMapsEmbedTokenResponse } from '@shared/v1/res';

import { SkipResponseWrap } from '../../core/interceptors/response-wrap.interceptor';
import { env } from '../../core/config/env';
import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { buildMapsEmbedSrc, renderMapsEmbedPage } from './maps-embed.html';
import { MAPS_EMBED_TOKEN_TTL_MS, signMapsEmbedToken, verifyMapsEmbedToken } from './maps-embed.token';

// クライアントには渡さない内部向けエンドポイントのため Swagger には出さない
// （robots.txt / share と同じ扱い）
@ApiExcludeController()
@Controller('v1/maps')
export class MapsController {
  /* ------------------------------------------------------------------ */
  /*                   POST /v1/maps/embed-token                        */
  /* ------------------------------------------------------------------ */

  /**
   * GET /v1/maps/embed 用の短命トークンを発行する。認証必須（匿名可）。
   */
  @Post('embed-token')
  @UseGuards(AuthAnonGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createEmbedToken(@Body() dto: CreateMapsEmbedTokenDto): CreateMapsEmbedTokenResponse {
    this.assertEmbedApiKeyConfigured();

    const now = Date.now();
    const token = signMapsEmbedToken(
      { mode: dto.mode, q: dto.q, center: dto.center, zoom: dto.zoom, hl: dto.hl },
      env.SUPABASE_JWT_SECRET,
      now,
    );
    return { token, expiresAt: new Date(now + MAPS_EMBED_TOKEN_TTL_MS).toISOString() };
  }

  /* ------------------------------------------------------------------ */
  /*                       GET /v1/maps/embed                           */
  /* ------------------------------------------------------------------ */

  /**
   * iframe 入りの HTML を返す。WebView（ネイティブ）/ iframe（web）がこの URL を
   * そのまま `uri` / `src` として読む（＝ API キーはネットワーク越しにここでしか出ない）。
   *
   * ガードは付けられない（WebView / iframe は Authorization ヘッダを送れない）ため、
   * 代わりに `token`（POST /v1/maps/embed-token が発行）の署名と有効期限を検証する。
   */
  @Get('embed')
  @SkipResponseWrap()
  @Header('Content-Type', 'text/html; charset=utf-8')
  // #1810 PL レビュー 5番: 本文に API キーを含む HTML なので、中間キャッシュ（CDN/プロキシ）に
  // 保存させない private にする
  @Header('Cache-Control', 'private, max-age=300')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  getEmbed(@Query() query: QueryMapsEmbedDto): string {
    this.assertEmbedApiKeyConfigured();

    const payload = verifyMapsEmbedToken(query.token, env.SUPABASE_JWT_SECRET, Date.now());
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired maps embed token');
    }

    const src = buildMapsEmbedSrc({
      mode: payload.mode,
      q: payload.q,
      center: payload.center,
      zoom: payload.zoom,
      hl: payload.hl,
      apiKey: env.GOOGLE_MAPS_EMBED_API_KEY as string,
    });
    return renderMapsEmbedPage(src);
  }

  /**
   * #843 オーナーが GCP で Maps Embed API を有効化し、キーを発行するまでは値が無い。
   * 未設定を «エラー» ではなく «この機能だけ使えない» として 503 で返し、
   * クライアント側は既存の外部ブラウザ遷移へ縮退する。
   */
  private assertEmbedApiKeyConfigured(): void {
    if (!env.GOOGLE_MAPS_EMBED_API_KEY) {
      throw new ServiceUnavailableException('Google Maps Embed API key is not configured');
    }
  }
}
